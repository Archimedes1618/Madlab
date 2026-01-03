<p align="center">
  <img width="256" height="256" alt="Madlab" src="https://github.com/user-attachments/assets/c877753d-08ca-4c71-a3ec-3195082e0b31" />
</p>

<h1 align="center">Madlab</h1>
<p align="center">Local LLM fine-tuning studio. Import datasets, train models, export to GGUF.</p>

---

## What is this?

Madlab is a self-hosted tool for fine-tuning language models on your own hardware. It handles the annoying parts: dataset formatting, training config, GGUF conversion, and evaluation. Works with any HuggingFace model.

**Stack:** React frontend + Node.js backend + Python training scripts (PyTorch/Transformers)

---

## Quick Start

```bash
# Clone
git clone https://github.com/yourusername/madlab.git
cd madlab

# Backend
cd madlab-backend
npm install
cd trainer && python -m venv venv && venv\Scripts\activate && python setup.py && cd ..
npm run build && npm start

# Frontend (new terminal)
cd madlab-frontend
npm install && npm run dev
```

Open `http://localhost:5173`

<img width="1863" height="943" alt="image789" src="https://github.com/user-attachments/assets/c5863659-f8ca-4db1-9a97-c2ab66173000" />

---

## Requirements

| Dependency | Version | Notes |
|------------|---------|-------|
| Node.js | 18+ | Backend server |
| Python | 3.10+ | Training scripts |
| CUDA | 11.8+ | Optional, for GPU training |
| LM Studio | Any | Optional, for Magic Import/Judge features |

**Hardware:**
- CPU training: Works, but slow. Fine for small models (<1B params)
- GPU training: NVIDIA with 8GB+ VRAM recommended

---

## Setup

<img width="819" height="837" alt="image456" src="https://github.com/user-attachments/assets/20eea2c8-9dd7-4bf9-b620-7d5fa2d700db" />

### Backend

```bash
cd madlab-backend
npm install
```

Python environment (inside `trainer/` folder):
```bash
cd trainer
python -m venv venv

# Windows
venv\Scripts\activate

# Linux/Mac
source venv/bin/activate

# For GPU training - first check your CUDA version: nvidia-smi
# Then install PyTorch with matching CUDA in setup.py:

python setup.py

cd ..
```

Build and run:
```bash
npm run build
npm start
```

Backend runs on `http://localhost:8080`

### Frontend

```bash
cd madlab-frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`

---

## Configuration

### Backend (.env)

Create `madlab-backend/.env`:
```env
PORT=8080
LM_STUDIO_URL=http://localhost:1234
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000

# Optional: Increase timeouts for slower systems (in milliseconds)
# FETCH_TIMEOUT=60000    # Default: 60s - for HuggingFace API calls
# LLM_TIMEOUT=300000     # Default: 5min - for LLM inference calls
```

### Frontend (.env)

Create `madlab-frontend/.env`:
```env
VITE_API_URL=http://localhost:8080
VITE_WS_URL=ws://localhost:8080/events
```

---

## Usage

<img width="1863" height="948" alt="image123" src="https://github.com/user-attachments/assets/acc9e63b-1da2-41ae-a7e3-defd210294ab" />

### Basic Workflow

1. **Pick a model** - Enter a HuggingFace model ID (e.g., `TinyLlama/TinyLlama-1.1B-Chat-v1.0`) or browse
2. **Get data** - Three options:
   - **Import** from HuggingFace datasets
   - **Upload** your own `.jsonl` files
   - **Generate** synthetic data from examples
3. **Configure** - Set epochs, batch size, learning rate, device (CPU/CUDA)
4. **Train** - Hit start, watch logs in Monitoring tab
5. **Convert** - Export to GGUF (f16 or q8_0 quantized)
6. **Evaluate** - Run against validation set

### Dataset Format

Your `.jsonl` files need `input` and `target` fields:
```json
{"input": "What is 2+2?", "target": "4"}
{"input": "Capital of France?", "target": "Paris"}
```

Magic Import tries to auto-convert other formats using an LLM.

### LM Studio Features

If you have LM Studio running locally:
- **Magic Import** - Auto-formats any HuggingFace dataset
- **Magic Judge** - LLM-based evaluation of model outputs
- **Synthetic Data** - Generate training data from examples

Point `LM_STUDIO_URL` to your instance (default: `http://localhost:1234`)

---

## Project Structure

```
madlab/
├── madlab-backend/
│   ├── src/
│   │   ├── routes/        # API endpoints
│   │   ├── services/      # Training, conversion logic
│   │   ├── utils/         # Security, fetch utilities
│   │   ├── types/         # TypeScript interfaces
│   │   ├── config.ts      # Centralized configuration
│   │   └── server.ts      # Express server
│   ├── trainer/           # Python scripts
│   │   ├── train.py       # Fine-tuning script
│   │   ├── data_tools.py  # Dataset utilities
│   │   └── evaluate_gguf.py
│   └── data/              # Datasets stored here
│
├── madlab-frontend/
│   └── src/
│       ├── components/    # React components
│       ├── types.ts       # TypeScript interfaces
│       └── App.tsx
```

---

## Troubleshooting

### llama-cpp-python installation fails
<img width="490" height="52" alt="image" src="https://github.com/user-attachments/assets/a3079c5f-3c08-4a56-b5a3-1fc4ade3d8ea" />

Replace the entire content of your madlab-backend/trainer/requirements.txt with this block:

```
transformers
accelerate
peft
bitsandbytes
scipy
huggingface_hub[hf_xet]
protobuf
sentencepiece
datasets
pandas
mistral-common[image,audio]
matplotlib

# Use custom llama-cpp-python wheel
https://github.com/rookiemann/llama-cpp-python-py314-cuda131-wheel-or-python314-llama-cpp-gpu-wheel/releases/download/v0.3.16-cuda13.1-py3.14/llama_cpp_python-0.3.16-cp314-cp314-win_amd64.whl

# Install gguf directly from llama.cpp repo
https://github.com/ggml-org/llama.cpp/archive/refs/heads/master.zip#subdirectory=gguf-py
```


### "CUDA not available"
- Check `nvidia-smi` works in terminal - note the CUDA version shown
- Make sure you installed PyTorch with matching CUDA support (see Setup section)
- Reinstall PyTorch with your CUDA version:
  - First, uninstall any existing installation:
    - `pip uninstall torch torchvision torchaudio -y`
  - CUDA 11.8 (older GPUs, GTX 10xx/16xx, RTX 20xx):
    - `pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118`
  - CUDA 12.1 (RTX 30xx, RTX 40xx):
    - `pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121`
  - CUDA 12.4 (RTX 40xx, newer drivers):
    - `pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124`
  - CUDA 12.6 (latest stable, RTX 40xx/50xx):
    - `pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126`
  - CUDA 13.0 (nightly, experimental support for RTX PRO 6000 Blackwell):
    - `pip install --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu130`
- Or just use CPU: set device to "CPU" in the UI (slower but works)

### "Model not found"
- Check the HuggingFace model ID is correct
- Some models require authentication: `huggingface-cli login`

### Training is slow
- Use GPU if possible
- Reduce `max_seq_len` (default 512)
- Reduce batch size if running out of memory

### Timeout errors / Operations timing out
- Increase timeouts in `.env` file (see Configuration section)
- Set `FETCH_TIMEOUT=120000` for slow HuggingFace API calls
- Set `LLM_TIMEOUT=600000` for very slow LLM inference

### "Failed to connect to LM Studio"
- Start LM Studio and load a model
- Check the URL in `.env` matches your LM Studio server
- Magic features work without it, just no auto-formatting

### WebSocket disconnects
- Backend might have crashed, check terminal
- Refresh the page

### Port already in use
- Change `PORT` in backend `.env`
- Update `VITE_API_URL` and `VITE_WS_URL` in frontend `.env` to match

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Server health check |
| `/datasets` | GET | List all datasets |
| `/datasets/import` | POST | Import from HuggingFace |
| `/datasets/upload` | POST | Upload .jsonl file |
| `/train/start` | POST | Start training |
| `/train/stop` | POST | Stop training |
| `/train/status` | GET | Training status |
| `/train/config` | GET/POST | Get/update training config |
| `/train/artifacts` | GET | List model artifacts |
| `/instillations` | GET/POST/PUT/DELETE | Manage instillations |

---

## License

AGPLv3 - See [LICENSE](LICENSE) file.

Copyright (C) 2025 David Bentler
