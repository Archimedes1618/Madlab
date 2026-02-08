# train.py
import json, argparse, torch, math, sys, os, random, shutil, signal, glob, time, gc, yaml
from functools import partial
from torch.utils.data import Dataset, DataLoader
from transformers import AutoModelForCausalLM, AutoTokenizer, get_linear_schedule_with_warmup, get_cosine_schedule_with_warmup, get_cosine_with_min_lr_schedule_with_warmup, get_constant_schedule_with_warmup, BitsAndBytesConfig
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training, PeftModel, get_peft_model_state_dict

# Flash Attention detection
def get_attn_implementation(requested: str = "auto") -> str:
    """Returns best available attention implementation: flash_attention_2 > sdpa > eager"""
    if requested not in ("auto", "flash_attention_2", "sdpa", "eager"):
        requested = "auto"
    if requested != "auto":
        return requested
    try:
        import flash_attn  # noqa: F401
        return "flash_attention_2"
    except ImportError:
        pass
    if hasattr(torch.nn.functional, "scaled_dot_product_attention"):
        return "sdpa"
    return "eager"

# Ensure stdout is unbuffered for real-time logging
sys.stdout.reconfigure(line_buffering=True)

# Set random seed for reproducibility
SEED = 42
random.seed(SEED)
torch.manual_seed(SEED)

# Checkpoint management
CHECKPOINT_DIR = None
EMERGENCY_SAVE = {"model": None, "opt": None, "sch": None, "epoch": 0, "best_loss": float('inf')}

def save_checkpoint(model, optimizer, scheduler, epoch, best_loss, checkpoint_dir, keep_last=3):
    os.makedirs(checkpoint_dir, exist_ok=True)
    path = os.path.join(checkpoint_dir, f"checkpoint_epoch_{epoch}.pt")
    # For PeftModel (LoRA), save only adapter weights (~50MB vs ~14GB full model)
    is_peft = isinstance(model, PeftModel)
    model_state = get_peft_model_state_dict(model) if is_peft else model.state_dict()
    torch.save({"epoch": epoch, "model_state": model_state, "optimizer_state": optimizer.state_dict(),
                "scheduler_state": scheduler.state_dict() if scheduler else None, "best_loss": best_loss, "is_peft": is_peft}, path)
    print(json.dumps({"message": f"Checkpoint saved: {path}", "is_peft": is_peft}))
    # Cleanup old checkpoints
    ckpts = sorted(glob.glob(os.path.join(checkpoint_dir, "checkpoint_epoch_*.pt")), key=os.path.getmtime)
    for old in ckpts[:-keep_last]:
        os.remove(old)

def load_checkpoint(checkpoint_dir):
    ckpts = sorted(glob.glob(os.path.join(checkpoint_dir, "checkpoint_epoch_*.pt")), key=os.path.getmtime)
    if not ckpts:
        return None
    ckpt = torch.load(ckpts[-1], weights_only=False)
    print(json.dumps({"message": f"Resuming from checkpoint: {ckpts[-1]}"}))
    return ckpt

def emergency_save_handler(signum, frame):
    if EMERGENCY_SAVE["model"] and CHECKPOINT_DIR:
        save_checkpoint(EMERGENCY_SAVE["model"], EMERGENCY_SAVE["opt"], EMERGENCY_SAVE["sch"], EMERGENCY_SAVE["epoch"], EMERGENCY_SAVE["best_loss"], CHECKPOINT_DIR)
        print(json.dumps({"message": "Emergency checkpoint saved on interrupt"}))
    sys.exit(0)

class PairDataset(Dataset):
    def __init__(self, path, tokenizer, max_len=512):
        self.samples = []
        with open(path, 'r', encoding='utf-8') as f:
            for line_num, line in enumerate(f, 1):
                if line.strip():
                    try:
                        self.samples.append(json.loads(line))
                    except json.JSONDecodeError as e:
                        print(json.dumps({"warning": f"Skipping invalid JSON at line {line_num}: {e}"}))
        self.tok = tokenizer
        self.max_len = max_len
    def __len__(self): return len(self.samples)
    def __getitem__(self, i):
        s = self.samples[i]
        prompt = f"Input: {s['input']}\nOutput: "
        target = s['target'] + self.tok.eos_token

        # Tokenize full sequence with offset mapping to find exact prompt boundary
        full_text = prompt + target
        enc = self.tok(full_text, return_tensors='pt', truncation=True, max_length=self.max_len,
                       add_special_tokens=True, return_offsets_mapping=True)
        input_ids = enc['input_ids'][0]
        labels = input_ids.clone()
        offsets = enc['offset_mapping'][0]

        # Find token index where prompt ends (character position = len(prompt))
        prompt_char_end = len(prompt)
        prompt_len = 0
        for idx, (start, end) in enumerate(offsets):
            if end <= prompt_char_end:
                prompt_len = idx + 1
            else:
                break

        # Mask the prompt portion (train only on target)
        if prompt_len < labels.shape[0]:
            labels[:prompt_len] = -100
        else:
            labels[:] = -100

        return {'input_ids': input_ids, 'labels': labels}


class PackedDataset(Dataset):
    """Concatenates samples into sequences of max_seq_len with block-diagonal attention mask."""
    def __init__(self, samples, tokenizer, max_len=2048):
        self.tok = tokenizer
        self.max_len = max_len
        self.packed_seqs = []
        self._pack_samples(samples)
    
    def _tokenize_sample(self, s):
        prompt = f"Input: {s['input']}\nOutput: "
        target = s['target'] + self.tok.eos_token
        full_text = prompt + target
        enc = self.tok(full_text, return_tensors='pt', truncation=True, max_length=self.max_len,
                       add_special_tokens=True, return_offsets_mapping=True)
        input_ids = enc['input_ids'][0]
        labels = input_ids.clone()
        offsets = enc['offset_mapping'][0]

        # Find token index where prompt ends
        prompt_char_end = len(prompt)
        prompt_len = 0
        for idx, (start, end) in enumerate(offsets):
            if end <= prompt_char_end:
                prompt_len = idx + 1
            else:
                break

        if prompt_len < labels.shape[0]:
            labels[:prompt_len] = -100
        else:
            labels[:] = -100
        return input_ids, labels
    
    def _pack_samples(self, samples):
        """Pack samples into sequences of max_len with block-diagonal attention."""
        all_tokenized = [self._tokenize_sample(s) for s in samples]
        original_count = len(all_tokenized)
        
        current_ids, current_labels, current_boundaries = [], [], []
        current_len = 0
        
        for input_ids, labels in all_tokenized:
            seq_len = input_ids.shape[0]
            if seq_len > self.max_len:
                continue  # skip sequences longer than max_len
            if current_len + seq_len > self.max_len:
                # finalize current pack
                if current_ids:
                    self.packed_seqs.append(self._finalize_pack(current_ids, current_labels, current_boundaries))
                current_ids, current_labels, current_boundaries = [], [], []
                current_len = 0
            current_boundaries.append((current_len, current_len + seq_len))
            current_ids.append(input_ids)
            current_labels.append(labels)
            current_len += seq_len
        
        if current_ids:
            self.packed_seqs.append(self._finalize_pack(current_ids, current_labels, current_boundaries))
        
        efficiency = original_count / len(self.packed_seqs) if self.packed_seqs else 0
        print(json.dumps({"message": f"Packed {original_count} samples into {len(self.packed_seqs)} sequences ({efficiency:.1f}x efficiency)"}))
    
    def _finalize_pack(self, ids_list, labels_list, boundaries):
        input_ids = torch.cat(ids_list)
        labels = torch.cat(labels_list)
        # Build block-diagonal attention mask (2D: seq_len x seq_len)
        seq_len = input_ids.shape[0]
        attention_mask = torch.zeros(seq_len, seq_len, dtype=torch.bool)
        for start, end in boundaries:
            attention_mask[start:end, start:end] = True
        return {'input_ids': input_ids, 'labels': labels, 'attention_mask_2d': attention_mask}
    
    def __len__(self): return len(self.packed_seqs)
    def __getitem__(self, i): return self.packed_seqs[i]


def packed_collate(batch, pad_id):
    """Collate for packed sequences - pads and creates proper 4D attention mask."""
    max_len = max(t['input_ids'].shape[0] for t in batch)
    bs = len(batch)
    input_ids = torch.full((bs, max_len), pad_id, dtype=torch.long)
    labels = torch.full((bs, max_len), -100, dtype=torch.long)
    # 4D attention mask for flash attention: [batch, 1, seq, seq]
    attention_mask = torch.zeros(bs, 1, max_len, max_len, dtype=torch.bool)
    
    for i, t in enumerate(batch):
        seq_len = t['input_ids'].shape[0]
        input_ids[i, :seq_len] = t['input_ids']
        labels[i, :seq_len] = t['labels']
        attention_mask[i, 0, :seq_len, :seq_len] = t['attention_mask_2d']
    
    return {'input_ids': input_ids, 'labels': labels, 'attention_mask': attention_mask}


def collate(batch, pad_id):
    max_len = max(t['input_ids'].shape[0] for t in batch)
    input_ids = []
    labels = []
    for t in batch:
        pad_len = max_len - t['input_ids'].shape[0]
        input_ids.append(torch.cat([t['input_ids'], torch.full((pad_len,), pad_id)]))
        labels.append(torch.cat([t['labels'], torch.full((pad_len,), -100)]))
    return {'input_ids': torch.stack(input_ids), 'labels': torch.stack(labels)}

def evaluate(model, val_dl, device, use_cuda, amp_dtype):
    model.eval()
    total_loss = 0.0
    count = 0
    with torch.no_grad():
        for batch in val_dl:
            input_ids = batch['input_ids'].to(device)
            labels = batch['labels'].to(device)
            attn_mask = batch.get('attention_mask')
            if attn_mask is not None:
                attn_mask = attn_mask.to(device)
            with torch.amp.autocast('cuda', enabled=use_cuda, dtype=amp_dtype):
                out = model(input_ids=input_ids, labels=labels, attention_mask=attn_mask)
            if not (torch.isnan(out.loss) or torch.isinf(out.loss)):
                total_loss += out.loss.item()
                count += 1
    model.train()
    avg_loss = total_loss / count if count > 0 else float('inf')
    ppl = min(math.exp(avg_loss), 10000.0) if avg_loss < float('inf') else float('inf')
    return {"loss": avg_loss, "perplexity": ppl}

def merge_lora_for_gguf(model_name, tokenizer, save_path, peft_model=None):
    """
    Attempts to merge LoRA on GPU first. If that fails (OOM/Offload error),
    automatically falls back to CPU merging.

    If peft_model is None, loads adapter from save_path (use this when best
    checkpoint was already saved and current model may have diverged).
    """
    print(json.dumps({"message": "Starting LoRA merge process..."}))

    # Determine adapter source: use saved adapter if peft_model not provided
    if peft_model is None:
        # Use the already-saved adapter at save_path (e.g., best checkpoint)
        adapter_path = save_path
        print(json.dumps({"message": f"Using saved adapter from {adapter_path}"}))
    else:
        # Save current model's adapter to temp location
        adapter_path = os.path.join(save_path, "temp_lora_adapter")
        os.makedirs(adapter_path, exist_ok=True)
        print(json.dumps({"message": f"Saving temporary adapter to {adapter_path}"}))
        peft_model.save_pretrained(adapter_path)

    # Free up memory from the training session (only if we had a model to save)
    if peft_model is not None:
        del peft_model
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    base_model = None
    model = None
    merged_model = None
    gpu_success = False

    try:
        # --- ATTEMPT 1: FAST MERGE (GPU) ---
        if torch.cuda.is_available():
            try:
                print(json.dumps({"message": "Attempting fast merge on GPU..."}))

                base_model = AutoModelForCausalLM.from_pretrained(
                    model_name,
                    torch_dtype=torch.float16,
                    device_map="auto",
                    attn_implementation=get_attn_implementation()
                )

                model = PeftModel.from_pretrained(base_model, adapter_path)
                merged_model = model.merge_and_unload()

                print(json.dumps({"message": f"GPU Merge successful! Saving to {save_path}..."}))
                merged_model.save_pretrained(save_path)
                tokenizer.save_pretrained(save_path)
                gpu_success = True

            except Exception as e:
                error_msg = str(e).lower()
                if "out of memory" in error_msg or "offload" in error_msg:
                    print(json.dumps({"warning": f"GPU Merge failed (Low VRAM). Falling back to CPU. Details: {e}"}))
                else:
                    print(json.dumps({"warning": f"GPU Merge failed: {e}. Retrying on CPU..."}))

                # Cleanup failed GPU attempt
                del model, base_model, merged_model
                model = base_model = merged_model = None
                gc.collect()
                torch.cuda.empty_cache()

        # --- ATTEMPT 2: SAFE MERGE (CPU) ---
        if not gpu_success:
            print(json.dumps({"message": "Starting CPU Merge (Safe Mode)..."}))

            base_model = AutoModelForCausalLM.from_pretrained(
                model_name,
                torch_dtype=torch.float16,
                device_map="cpu",
                low_cpu_mem_usage=True,
                attn_implementation=get_attn_implementation()
            )

            model = PeftModel.from_pretrained(base_model, adapter_path, device_map="cpu")
            merged_model = model.merge_and_unload()

            print(json.dumps({"message": f"CPU Merge successful! Saving to {save_path}..."}))
            merged_model.save_pretrained(save_path)
            tokenizer.save_pretrained(save_path)

    except Exception as e:
        print(json.dumps({"error": f"Critical: Merge failed on both GPU and CPU. {str(e)}"}))
        raise

    finally:
        # Cleanup ALWAYS runs
        if model is not None:
            del model
        if merged_model is not None:
            del merged_model
        if base_model is not None:
            del base_model
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        # Only cleanup if we created a temp adapter directory (not when using saved adapter)
        temp_adapter_path = os.path.join(save_path, "temp_lora_adapter")
        if os.path.exists(temp_adapter_path):
            try:
                shutil.rmtree(temp_adapter_path)
            except (PermissionError, OSError):
                print(json.dumps({"warning": f"Failed to cleanup temp adapter: {temp_adapter_path}"}))


def main():
    global CHECKPOINT_DIR, EMERGENCY_SAVE
    ap = argparse.ArgumentParser()
    ap.add_argument('--config', required=True)
    ap.add_argument('--resume', action='store_true', help='Resume from latest checkpoint')
    args = ap.parse_args()
    signal.signal(signal.SIGINT, emergency_save_handler)
    
    print(json.dumps({"message": f"Loading config from {args.config}"}))
    
    with open(args.config, 'r') as f:
        cfg = yaml.safe_load(f)

    # Precision config
    precision_cfg = cfg.get('precision', {})
    use_fp16 = bool(precision_cfg.get('fp16', False))
    use_bf16 = bool(precision_cfg.get('bf16', False))
    if use_fp16:
        amp_dtype = torch.float16
        precision_mode = "FP16"
    elif use_bf16:
        amp_dtype = torch.bfloat16
        precision_mode = "BF16"
    else:
        amp_dtype = torch.float32
        precision_mode = "FP32"
    print(json.dumps({
    "message": f"Precision mode set to {precision_mode}",
    "amp_dtype": str(amp_dtype)
}))


    # Gradient accumulation
    grad_accum_steps = int(cfg['train'].get('grad_accum_steps', 1))
    if grad_accum_steps < 1:
        grad_accum_steps = 1

    # Strict Device Check - supports 'cpu', 'cuda', 'cuda:0', 'cuda:1', etc.
    requested_device = cfg['runtime']['device']
    if requested_device.startswith('cuda') and not torch.cuda.is_available():
        print(json.dumps({"error": "CUDA requested but not available. Please install CUDA drivers or switch to CPU."}))
        sys.exit(1)

    if requested_device.startswith('cuda'):
        device = torch.device(requested_device)
        device_idx = device.index if device.index is not None else 0
        torch.cuda.set_device(device_idx)  # Set as default CUDA device
    else:
        device = torch.device('cpu')

    print(json.dumps({"message": f"Using device: {device}"}))
    if device.type == 'cuda':
        device_idx = device.index if device.index is not None else 0
        print(json.dumps({"message": f"GPU {device_idx}: {torch.cuda.get_device_name(device_idx)}"}))

    # Load Model & Tokenizer
    model_name = cfg['model']['name']
    use_lora = cfg['model'].get('adapter') == 'Lora'
    print(json.dumps({"message": f"Loading model {model_name}...", "adapter": "Lora" if use_lora else "none"}))

    try:
        tok = AutoTokenizer.from_pretrained(model_name, use_fast=True)
        if tok.pad_token is None:
            tok.pad_token = tok.eos_token

        # Resolve attention implementation
        attn_impl = get_attn_implementation(cfg['model'].get('attn_implementation', 'auto'))
        print(json.dumps({"message": f"Using attention: {attn_impl}"}))

        if use_lora:
            bnb_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=amp_dtype,
                bnb_4bit_use_double_quant=True
            )
            model = AutoModelForCausalLM.from_pretrained(
                model_name, quantization_config=bnb_config, device_map="auto",
                attn_implementation=attn_impl
            )
            model = prepare_model_for_kbit_training(model)
            lora_config = LoraConfig(
                r=cfg['model'].get('lora_r', 16),
                lora_alpha=cfg['model'].get('lora_alpha', 32),
                target_modules=cfg['model'].get('lora_target_modules', ["q_proj", "k_proj", "v_proj", "o_proj"]),
                lora_dropout=cfg['model'].get('lora_dropout', 0.05),
                bias="none",
                task_type="CAUSAL_LM",
                use_dora=cfg['model'].get('use_dora', False)
            )
            model = get_peft_model(model, lora_config)
            model.print_trainable_parameters()
        else:
            model = AutoModelForCausalLM.from_pretrained(model_name, attn_implementation=attn_impl)
            model.to(device)

        if cfg['train'].get('gradient_checkpointing', False):
            model.gradient_checkpointing_enable()
            print(json.dumps({"message": "Gradient checkpointing enabled"}))

        # torch.compile JIT optimization (PyTorch 2.0+)
        if cfg['train'].get('torch_compile', False):
            if hasattr(torch, 'compile') and int(torch.__version__.split('.')[0]) >= 2:
                compile_mode = cfg['train'].get('torch_compile_mode', 'default')
                try:
                    model = torch.compile(model, mode=compile_mode)
                    print(json.dumps({"message": f"torch.compile enabled, mode={compile_mode}"}))
                except Exception as e:
                    print(json.dumps({"warning": f"torch.compile failed, using eager mode: {e}"}))

        # NEFTune: add noise to embeddings during training
        neftune_alpha = cfg['train'].get('neftune_noise_alpha', 0)
        if neftune_alpha > 0:
            embed_layer = model.get_input_embeddings()
            def neftune_hook(module, input, output):
                if module.training:
                    dims = torch.tensor(output.size(1) * output.size(2))
                    noise = torch.zeros_like(output).uniform_(-1, 1) * neftune_alpha / torch.sqrt(dims)
                    return output + noise
                return output
            embed_layer.register_forward_hook(neftune_hook)
            print(json.dumps({"message": f"NEFTune enabled with alpha={neftune_alpha}"}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

    # Dataset
    data_path = cfg['data']['path']
    if not os.path.exists(data_path):
        print(json.dumps({"error": f"Dataset not found at {data_path}"}))
        sys.exit(1)

    ds = PairDataset(data_path, tok, cfg['train']['max_seq_len'])
    if len(ds) == 0:
        print(json.dumps({"error": "Dataset is empty"}))
        sys.exit(1)

    max_samples = cfg['data'].get('max_samples')
    if max_samples and max_samples > 0 and max_samples < len(ds.samples):
        ds.samples = random.sample(ds.samples, max_samples)
        print(json.dumps({"message": f"Sampled {max_samples} from dataset"}))

    indices = list(range(len(ds)))
    random.shuffle(indices)

    n_val = max(1, int(len(ds)*cfg['data']['val_split']))
    # Ensure we don't take more than we have
    if n_val >= len(ds): n_val = 0

    val_indices = indices[:n_val]
    train_indices = indices[n_val:]

    # Save validation split for evaluation
    val_samples = [ds.samples[i] for i in val_indices]
    val_path = os.path.join(os.path.dirname(data_path), 'val.jsonl')
    with open(val_path, 'w', encoding='utf-8') as f:
        for s in val_samples:
            f.write(json.dumps(s) + '\n')
    print(json.dumps({"message": f"Saved {len(val_samples)} validation samples to {val_path}"}))
    
    train_samples = [ds.samples[i] for i in train_indices]
    if len(train_samples) == 0:
         print(json.dumps({"error": "Training set is empty"}))
         sys.exit(1)

    use_packing = cfg['train'].get('packing', False)
    use_cuda = (device.type == 'cuda')
    
    if use_packing:
        print(json.dumps({"message": "Packing enabled - concatenating samples into dense sequences"}))
        train_ds = PackedDataset(train_samples, tok, cfg['train']['max_seq_len'])
        val_ds = PackedDataset(val_samples, tok, cfg['train']['max_seq_len']) if val_samples else None
        collate_fn = partial(packed_collate, pad_id=tok.pad_token_id)
    else:
        val_ds = torch.utils.data.Subset(ds, val_indices)
        train_ds = torch.utils.data.Subset(ds, train_indices)
        collate_fn = partial(collate, pad_id=tok.pad_token_id)

    train_dl = DataLoader(train_ds, batch_size=cfg['train']['batch_size'], shuffle=not use_packing,
                          num_workers=cfg['runtime'].get('workers', 0),
                          collate_fn=collate_fn,
                          pin_memory=use_cuda)
    val_dl = DataLoader(val_ds, batch_size=cfg['train']['batch_size'], shuffle=False,
                        collate_fn=collate_fn, pin_memory=use_cuda) if val_ds and len(val_ds) > 0 else None

    # Optimizer
    lr = float(cfg['train']['lr'])
    weight_decay = cfg['train']['weight_decay']
    optimizer_type = cfg['train'].get('optimizer', 'adamw')
    params = model.parameters()
    if optimizer_type == 'adamw_8bit':
        import bitsandbytes as bnb
        opt = bnb.optim.AdamW8bit(params, lr=lr, weight_decay=weight_decay)
    elif optimizer_type == 'paged_adamw_8bit':
        import bitsandbytes as bnb
        opt = bnb.optim.PagedAdamW8bit(params, lr=lr, weight_decay=weight_decay)
    elif optimizer_type == 'adamw_fused' and torch.cuda.is_available():
        opt = torch.optim.AdamW(params, lr=lr, weight_decay=weight_decay, fused=True)
    else:
        opt = torch.optim.AdamW(params, lr=lr, weight_decay=weight_decay, foreach=True)
    print(json.dumps({"message": f"Optimizer: {optimizer_type}"}))

    # Scheduler
    steps_per_epoch = math.ceil(len(train_dl) / grad_accum_steps)
    total_opt_steps = cfg['train']['epochs'] * steps_per_epoch
    warmup = min(cfg['train']['warmup_steps'], total_opt_steps)
    scheduler_type = cfg['train'].get('lr_scheduler', 'linear')
    lr_min = cfg['train'].get('lr_min', 0)
    if scheduler_type == 'cosine':
        min_lr_rate = lr_min / lr if lr > 0 else 0
        sch = get_cosine_with_min_lr_schedule_with_warmup(opt, num_warmup_steps=warmup, num_training_steps=total_opt_steps, min_lr_rate=min_lr_rate)
        print(json.dumps({"message": f"Scheduler: cosine, lr_min={lr_min}, min_lr_rate={min_lr_rate:.4f}"}))
    elif scheduler_type == 'constant':
        sch = get_constant_schedule_with_warmup(opt, num_warmup_steps=warmup)
    else:
        sch = get_linear_schedule_with_warmup(opt, num_warmup_steps=warmup, num_training_steps=total_opt_steps)

    # AMP Scaler
    scaler = torch.amp.GradScaler('cuda', enabled=use_cuda)

    batch_step = 0
    opt_step = 0
    save_path = cfg['model']['save_path']
    save_dir = os.path.dirname(save_path)
    if save_dir:
        os.makedirs(save_dir, exist_ok=True)

    # Checkpoint setup
    run_id = cfg.get('run_id', 'default')
    CHECKPOINT_DIR = os.path.join(save_dir or 'models', 'checkpoints', run_id)
    start_epoch = 0
    best_val_loss = float('inf')
    if args.resume:
        ckpt = load_checkpoint(CHECKPOINT_DIR)
        if ckpt:
            # Handle LoRA adapter-only checkpoints (strict=False for adapter weights only)
            is_peft_ckpt = ckpt.get('is_peft', False)
            model.load_state_dict(ckpt['model_state'], strict=not is_peft_ckpt)
            opt.load_state_dict(ckpt['optimizer_state'])
            if ckpt.get('scheduler_state'):
                sch.load_state_dict(ckpt['scheduler_state'])
            start_epoch = ckpt['epoch'] + 1
            best_val_loss = ckpt['best_loss']
    patience_counter = 0
    patience = cfg['train'].get('early_stopping_patience', 0)
    save_best_only = cfg['train'].get('save_best_only', False)

    print(json.dumps({"message": "Starting training loop"}))

    early_stopped = False
    for epoch in range(start_epoch, cfg['train']['epochs']):
        model.train()
        for batch in train_dl:
            input_ids = batch['input_ids'].to(device)
            labels = batch['labels'].to(device)
            attn_mask = batch.get('attention_mask')
            if attn_mask is not None:
                attn_mask = attn_mask.to(device)

            with torch.amp.autocast('cuda', enabled=use_cuda, dtype=amp_dtype):
                out = model(input_ids=input_ids, labels=labels, attention_mask=attn_mask)
                loss = out.loss

            if torch.isnan(loss) or torch.isinf(loss):
                print(json.dumps({"warning": f"NaN/Inf loss detected at batch {batch_step}, skipping"}))
                model.zero_grad()
                batch_step += 1
                continue

            # Gradient accumulation
            scaled_loss = loss / grad_accum_steps
            scaler.scale(scaled_loss).backward()
            batch_step += 1

            if batch_step % grad_accum_steps == 0:
                scaler.unscale_(opt)
                grad_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), cfg['train']['grad_clip'])

                scaler.step(opt)
                scaler.update()
                sch.step()
                model.zero_grad()
                opt_step += 1

                # Log based on optimizer steps, not batch steps
                if opt_step % cfg['train']['log_every'] == 0:
                    print(json.dumps({
                        'loss': float(loss.item()),
                        'grad_norm': float(grad_norm),
                        'learning_rate': float(sch.get_last_lr()[0]),
                        'epoch': float(epoch) + ((opt_step % steps_per_epoch or steps_per_epoch) / steps_per_epoch),
                        'step': opt_step
                    }), flush=True)

                if opt_step % cfg['train']['save_every'] == 0:
                    model.save_pretrained(save_path)
                    tok.save_pretrained(save_path)
                    print(json.dumps({"message": "Checkpoint saved"}))

        # Flush any remaining accumulated gradients at epoch end
        if batch_step % grad_accum_steps != 0:
            scaler.unscale_(opt)
            grad_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), cfg['train']['grad_clip'])
            scaler.step(opt)
            scaler.update()
            sch.step()
            model.zero_grad()
            opt_step += 1

        if val_dl:
            val_metrics = evaluate(model, val_dl, device, use_cuda, amp_dtype)
            val_loss = val_metrics["loss"]
            print(json.dumps({"val_loss": val_loss, "val_perplexity": val_metrics["perplexity"], "epoch": epoch + 1}))
            if val_loss < best_val_loss:
                best_val_loss = val_loss
                patience_counter = 0
                if save_best_only:
                    model.save_pretrained(save_path)
                    tok.save_pretrained(save_path)
                    print(json.dumps({"message": "Best model saved"}))
            elif patience > 0:
                patience_counter += 1
                if patience_counter >= patience:
                    print(json.dumps({"message": f"Early stopping at epoch {epoch + 1}"}))
                    early_stopped = True
                    break
        # Save checkpoint every epoch
        EMERGENCY_SAVE.update({"model": model, "opt": opt, "sch": sch, "epoch": epoch, "best_loss": best_val_loss})
        save_checkpoint(model, opt, sch, epoch, best_val_loss, CHECKPOINT_DIR)

    # Only save final model if:
    # - Not using save_best_only with validation (best checkpoint already saved)
    # - Not early stopped (best checkpoint already saved when early_stopped)
    if not (save_best_only and val_dl) and not early_stopped:
        print(json.dumps({"message": f"Saving final checkpoint to {save_path}"}))
        model.save_pretrained(save_path)
        tok.save_pretrained(save_path)

    # --- NEW MERGE LOGIC ---
    # Merge LoRA adapter into base model for GGUF conversion compatibility
    if use_lora:
        # When save_best_only with validation, best adapter is already saved to save_path.
        # Pass None to use that saved adapter instead of current (possibly overfit) model.
        use_saved = save_best_only and val_dl is not None
        merge_lora_for_gguf(model_name, tok, save_path, peft_model=None if use_saved else model)
    else:
        print(json.dumps({"message": "No LoRA adapter used. Skipping merge for GGUF."}))


    # GPU memory cleanup
    if device.type == 'cuda':
        torch.cuda.empty_cache()

    print(json.dumps({"status": "complete", "message": "Training complete", "saved_to": save_path}))

if __name__ == '__main__':
    main()