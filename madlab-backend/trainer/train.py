# train.py
import json, argparse, torch, math, sys, os
from torch.utils.data import Dataset, DataLoader
from transformers import AutoModelForCausalLM, AutoTokenizer, get_linear_schedule_with_warmup

# Ensure stdout is unbuffered for real-time logging
sys.stdout.reconfigure(line_buffering=True)

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

def main():
    import yaml
    ap = argparse.ArgumentParser()
    ap.add_argument('--config', required=True)
    args = ap.parse_args()
    
    print(json.dumps({"message": f"Loading config from {args.config}"}))
    
    with open(args.config, 'r') as f:
        cfg = yaml.safe_load(f)

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
    print(json.dumps({"message": f"Loading model {model_name}..."}))
    
    try:
        tok = AutoTokenizer.from_pretrained(model_name, use_fast=True)
        # Ensure pad token exists
        if tok.pad_token is None:
            tok.pad_token = tok.eos_token
            
        model = AutoModelForCausalLM.from_pretrained(model_name)
        model.to(device)
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

    n_val = max(1, int(len(ds)*cfg['data']['val_split']))
    # Ensure we don't take more than we have
    if n_val >= len(ds): n_val = 0
    
    val_ds = torch.utils.data.Subset(ds, range(n_val))
    train_ds = torch.utils.data.Subset(ds, range(n_val, len(ds)))
    
    # Save validation split for evaluation
    val_samples = [ds.samples[i] for i in range(n_val)]
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
    
    # Optimizer
    opt = torch.optim.AdamW(model.parameters(), lr=float(cfg['train']['lr']), weight_decay=cfg['train']['weight_decay'])
    total_steps = cfg['train']['epochs'] * len(train_dl)
    sch = get_linear_schedule_with_warmup(opt, num_warmup_steps=cfg['train']['warmup_steps'], num_training_steps=total_steps)

    # AMP Scaler - Use new API if available, else legacy (compat)
    # The user is seeing warnings, so let's use the new torch.amp API
    scaler = torch.amp.GradScaler('cuda', enabled=use_cuda)

    step = 0
    save_path = cfg['model']['save_path']
    os.makedirs(os.path.dirname(save_path), exist_ok=True)

    print(json.dumps({"message": "Starting training loop"}))

    for epoch in range(cfg['train']['epochs']):
        model.train()
        for batch in train_dl:
            input_ids = batch['input_ids'].to(device)
            labels = batch['labels'].to(device)
            
            with torch.amp.autocast('cuda', enabled=use_cuda):
                out = model(input_ids=input_ids, labels=labels)
                loss = out.loss
            
            scaler.scale(loss).backward()
            
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(model.parameters(), cfg['train']['grad_clip'])
            
            scaler.step(opt)
            scaler.update()
            
            sch.step()
            model.zero_grad()
            step += 1
            
            if step % cfg['train']['log_every'] == 0:
                 grad_norm = 0.0
                 for p in model.parameters():
                     if p.grad is not None:
                         grad_norm += p.grad.detach().data.norm().item() ** 2
                 grad_norm = grad_norm ** 0.5
                 
                 print(json.dumps({
                     'loss': float(loss.item()),
                     'grad_norm': float(grad_norm),
                     'learning_rate': float(sch.get_last_lr()[0]),
                     'epoch': float(epoch) + (step / total_steps) * cfg['train']['epochs'], # rough approximation
                     'step': step
                 }), flush=True)
            
            if step % cfg['train']['save_every'] == 0:
                 model.save_pretrained(save_path)
                 tok.save_pretrained(save_path)
                 print(json.dumps({"message": "Checkpoint saved"}))

    # Final save
    print(json.dumps({"message": f"Saving model to {save_path}"}))
    model.save_pretrained(save_path)
    tok.save_pretrained(save_path)
    print(json.dumps({"message": "Training complete", "saved_to": save_path}))

if __name__ == '__main__':
    main()
