# train.py
import json, argparse, torch, math, sys, os, random, shutil
from pathlib import Path
from torch.utils.data import Dataset, DataLoader
from transformers import AutoModelForCausalLM, AutoTokenizer, get_linear_schedule_with_warmup, get_cosine_schedule_with_warmup, get_constant_schedule_with_warmup, BitsAndBytesConfig
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training, PeftModel # Added PeftModel import

# Ensure stdout is unbuffered for real-time logging
sys.stdout.reconfigure(line_buffering=True)

# Set random seed for reproducibility
SEED = 42
random.seed(SEED)
torch.manual_seed(SEED)

def get_config_value(cfg, keys, default):
    """Safely get nested config value with default fallback."""
    try:
        value = cfg
        for key in keys:
            value = value[key]
        return value
    except (KeyError, TypeError):
        return default

class PairDataset(Dataset):
    def __init__(self, path, tokenizer, max_len=512):
        self.samples = []
        with open(path, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    self.samples.append(json.loads(line))
        self.tok = tokenizer
        self.max_len = max_len
    def __len__(self): return len(self.samples)
    def __getitem__(self, i):
        s = self.samples[i]
        text = f"Input: {s['input']}\nOutput:"
        target = s['target']
        # Simple concatenation for causal LM training
        # We want to train on the target part, given the input part.
        
        # Tokenize full sequence
        full_text = text + " " + target + self.tok.eos_token
        enc = self.tok(full_text, return_tensors='pt', truncation=True, max_length=self.max_len)
        input_ids = enc['input_ids'][0]
        
        # Create labels: -100 for non-target tokens
        labels = input_ids.clone()
        
        # Find where the target starts (heuristic matching or separate tokenization)
        # For simplicity/robustness, let's tokenize just the prompt to find its length
        prompt_enc = self.tok(text, return_tensors='pt', truncation=True, max_length=self.max_len)
        prompt_len = prompt_enc['input_ids'].shape[1]
        
        # Mask the prompt
        if prompt_len < labels.shape[0]:
            labels[:prompt_len] = -100
        else:
            # If prompt is longer than max_len (truncated), then all is masked (or edge case)
            labels[:] = -100

        return {'input_ids': input_ids, 'labels': labels}

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
            with torch.amp.autocast('cuda', enabled=use_cuda, dtype=amp_dtype):
                out = model(input_ids=input_ids, labels=labels)
            if not (torch.isnan(out.loss) or torch.isinf(out.loss)):
                total_loss += out.loss.item()
                count += 1
    model.train()
    return total_loss / count if count > 0 else float('inf')

def merge_lora_for_gguf(model_name, tokenizer, save_path, peft_model):
    """
    Merges a PEFT (LoRA) model with its base model at full precision for GGUF conversion.
    This function assumes the LoRA adapter is already loaded in the `peft_model` variable.
    """
    print(json.dumps({"message": "Starting LoRA merge process for GGUF export..."}))
    
    # 1. Define a temporary path to save the LoRA adapter
    temp_adapter_path = os.path.join(save_path, "temp_lora_adapter")
    os.makedirs(temp_adapter_path, exist_ok=True)

    # 2. Save the LoRA adapter weights from the trained model
    print(json.dumps({"message": f"Saving LoRA adapter to temporary directory: {temp_adapter_path}"}))
    peft_model.save_pretrained(temp_adapter_path)
    
    # 3. Free up VRAM by deleting the quantized model
    print(json.dumps({"message": "Unloading quantized model from memory to free VRAM..."}))
    del peft_model
    torch.cuda.empty_cache()

    # 4. Reload the base model at FULL PRECISION (FP32)
    print(json.dumps({"message": f"Reloading base model '{model_name}' at full precision (FP32)..."}))
    base_model = AutoModelForCausalLM.from_pretrained(
        model_name,
        torch_dtype=torch.float32,  # Crucial: Load in full precision
        device_map="auto"           # Use 'auto' to load onto GPU/CPU as needed
    )

    # 5. Load the LoRA adapter onto the full-precision base model
    print(json.dumps({"message": "Applying LoRA adapter to full-precision model..."}))
    model = PeftModel.from_pretrained(base_model, temp_adapter_path)
    
    # 6. Merge the adapter into the base model
    print(json.dumps({"message": "Merging LoRA adapter with full-precision base model..."}))
    merged_model = model.merge_and_unload()

    # 7. Save the final, merged, full-precision model
    print(json.dumps({"message": f"Saving final merged model to {save_path}..."}))
    merged_model.save_pretrained(save_path)
    tokenizer.save_pretrained(save_path)
    
    # 8. Clean up the temporary adapter directory
    print(json.dumps({"message": f"Cleaning up temporary directory: {temp_adapter_path}"}))
    shutil.rmtree(temp_adapter_path)

    print(json.dumps({"message": "Merged model successfully saved at full precision. Ready for GGUF conversion."}))


def main():
    import yaml
    ap = argparse.ArgumentParser()
    ap.add_argument('--config', required=True)
    args = ap.parse_args()
    
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

    # Strict Device Check
    requested_device = cfg['runtime']['device']
    if requested_device == 'cuda' and not torch.cuda.is_available():
        print(json.dumps({"error": "CUDA requested but not available. Please install CUDA drivers or switch to CPU."}))
        sys.exit(1)
    
    device = torch.device('cuda' if requested_device == 'cuda' and torch.cuda.is_available() else 'cpu')
    print(json.dumps({"message": f"Using device: {device}"}))
    if device.type == 'cuda':
        print(json.dumps({"message": f"GPU: {torch.cuda.get_device_name(0)}"}))

    # Load Model & Tokenizer
    model_name = cfg['model']['name']
    use_lora = cfg['model'].get('adapter') == 'Lora'
    print(json.dumps({"message": f"Loading model {model_name}...", "adapter": "Lora" if use_lora else "none"}))

    try:
        tok = AutoTokenizer.from_pretrained(model_name, use_fast=True)
        if tok.pad_token is None:
            tok.pad_token = tok.eos_token

        if use_lora:
            bnb_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=amp_dtype,
                bnb_4bit_use_double_quant=True
            )
            model = AutoModelForCausalLM.from_pretrained(model_name, quantization_config=bnb_config, device_map="auto")
            model = prepare_model_for_kbit_training(model)
            lora_config = LoraConfig(
                r=cfg['model'].get('lora_r', 16),
                lora_alpha=cfg['model'].get('lora_alpha', 32),
                target_modules=cfg['model'].get('lora_target_modules', ["q_proj", "k_proj", "v_proj", "o_proj"]),
                lora_dropout=cfg['model'].get('lora_dropout', 0.05),
                bias="none",
                task_type="CAUSAL_LM"
            )
            model = get_peft_model(model, lora_config)
            model.print_trainable_parameters()
        else:
            model = AutoModelForCausalLM.from_pretrained(model_name)
            model.to(device)

        if cfg['train'].get('gradient_checkpointing', False):
            model.gradient_checkpointing_enable()
            print(json.dumps({"message": "Gradient checkpointing enabled"}))
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
    if max_samples and max_samples < len(ds.samples):
        ds.samples = random.sample(ds.samples, max_samples)
        print(json.dumps({"message": f"Sampled {max_samples} from dataset"}))

    indices = list(range(len(ds)))
    random.shuffle(indices)

    n_val = max(1, int(len(ds)*cfg['data']['val_split']))
    # Ensure we don't take more than we have
    if n_val >= len(ds): n_val = 0

    val_indices = indices[:n_val]
    train_indices = indices[n_val:]

    val_ds = torch.utils.data.Subset(ds, val_indices)
    train_ds = torch.utils.data.Subset(ds, train_indices)

    # Save validation split for evaluation
    val_samples = [ds.samples[i] for i in val_indices]
    val_path = os.path.join(os.path.dirname(data_path), 'val.jsonl')
    with open(val_path, 'w', encoding='utf-8') as f:
        for s in val_samples:
            f.write(json.dumps(s) + '\n')
    print(json.dumps({"message": f"Saved {len(val_samples)} validation samples to {val_path}"}))
    
    if len(train_ds) == 0:
         print(json.dumps({"error": "Training set is empty"}))
         sys.exit(1)

    # Use partial for pickling support on Windows
    from functools import partial
    collate_fn = partial(collate, pad_id=tok.pad_token_id)

    # Pin memory only if using CUDA
    use_cuda = (device.type == 'cuda')
    train_dl = DataLoader(train_ds, batch_size=cfg['train']['batch_size'], shuffle=True,
                          num_workers=cfg['runtime'].get('workers', 0),
                          collate_fn=collate_fn,
                          pin_memory=use_cuda)
    val_dl = DataLoader(val_ds, batch_size=cfg['train']['batch_size'], shuffle=False,
                        collate_fn=collate_fn, pin_memory=use_cuda) if len(val_ds) > 0 else None

    # Optimizer
    lr = float(cfg['train']['lr'])
    weight_decay = cfg['train']['weight_decay']
    optimizer_type = cfg['train'].get('optimizer', 'adamw')
    if optimizer_type == 'adamw_8bit':
        import bitsandbytes as bnb
        opt = bnb.optim.AdamW8bit(model.parameters(), lr=lr, weight_decay=weight_decay)
        print(json.dumps({"message": "Using 8-bit AdamW optimizer"}))
    else:
        opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)

    # Scheduler
    steps_per_epoch = math.ceil(len(train_dl) / grad_accum_steps)
    total_opt_steps = cfg['train']['epochs'] * steps_per_epoch
    warmup = min(cfg['train']['warmup_steps'], total_opt_steps)
    scheduler_type = cfg['train'].get('lr_scheduler', 'linear')
    if scheduler_type == 'cosine':
        sch = get_cosine_schedule_with_warmup(opt, num_warmup_steps=warmup, num_training_steps=total_opt_steps)
    elif scheduler_type == 'constant':
        sch = get_constant_schedule_with_warmup(opt, num_warmup_steps=warmup)
    else:
        sch = get_linear_schedule_with_warmup(opt, num_warmup_steps=warmup, num_training_steps=total_opt_steps)

    # AMP Scaler
    scaler = torch.amp.GradScaler('cuda', enabled=use_cuda)

    step = 0
    save_path = cfg['model']['save_path']
    os.makedirs(os.path.dirname(save_path), exist_ok=True)

    best_val_loss = float('inf')
    patience_counter = 0
    patience = cfg['train'].get('early_stopping_patience', 0)
    save_best_only = cfg['train'].get('save_best_only', False)

    print(json.dumps({"message": "Starting training loop"}))

    for epoch in range(cfg['train']['epochs']):
        model.train()
        for batch in train_dl:
            input_ids = batch['input_ids'].to(device)
            labels = batch['labels'].to(device)

            with torch.amp.autocast('cuda', enabled=use_cuda, dtype=amp_dtype):
                out = model(input_ids=input_ids, labels=labels)
                loss = out.loss

            if torch.isnan(loss) or torch.isinf(loss):
                print(json.dumps({"warning": f"NaN/Inf loss detected at step {step}, skipping batch"}))
                model.zero_grad()
                continue

            # Gradient accumulation
            loss = loss / grad_accum_steps
            scaler.scale(loss).backward()

            if (step + 1) % grad_accum_steps == 0:
                    # Unscale and clip once per optimizer cycle
                    scaler.unscale_(opt)
                    grad_norm = torch.nn.utils.clip_grad_norm_(model.parameters(),
                                                            cfg['train']['grad_clip'])

                    scaler.step(opt)
                    scaler.update()
                    sch.step()
                    model.zero_grad()

                    # Log here, immediately after clipping but before zero_grad
                    if step % cfg['train']['log_every'] == 0:
                        print(json.dumps({
                            'loss': float(loss.item() * grad_accum_steps),  # undo division for logging
                            'grad_norm': float(grad_norm),
                            'learning_rate': float(sch.get_last_lr()[0]),
                            'epoch': float(epoch) + (step / total_opt_steps),
                            'step': step
                        }), flush=True)

            step += 1

            if step % cfg['train']['save_every'] == 0:
                    model.save_pretrained(save_path)
                    tok.save_pretrained(save_path)
                    print(json.dumps({"message": "Checkpoint saved"}))

        if val_dl:
            val_loss = evaluate(model, val_dl, device, use_cuda, amp_dtype)
            print(json.dumps({"val_loss": val_loss, "epoch": epoch + 1}))
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
                    break

    if not (save_best_only and val_dl):
        print(json.dumps({"message": f"Saving final LoRA checkpoint to {save_path}"}))
        model.save_pretrained(save_path)
        tok.save_pretrained(save_path)

    # --- NEW MERGE LOGIC ---
    # Merge LoRA adapter into base model for GGUF conversion compatibility
    if use_lora:
        merge_lora_for_gguf(model_name, tok, save_path, model)
    else:
        print(json.dumps({"message": "No LoRA adapter used. Skipping merge for GGUF."}))


    # GPU memory cleanup
    if device.type == 'cuda':
        torch.cuda.empty_cache()

    print(json.dumps({"status": "complete", "message": "Training complete", "saved_to": save_path}))

if __name__ == '__main__':
    main()