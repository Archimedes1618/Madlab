
<img width="512" height="512" alt="An icon for &#39;Madlab&#39; in purple" src="https://github.com/user-attachments/assets/c877753d-08ca-4c71-a3ec-3195082e0b31" />



Copyright (C) 2025 David Bentler

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.


# Introduction

Madlab is an advanced AI development studio designed to streamline the process of dataset management, model training, and evaluation. It combines a robust Node.js/Express backend with a powerful Python-based training engine and a modern React frontend.

## Features

-   **Smart Dataset Import**: Automatically normalization of HuggingFace datasets using LLM-driven schema inspection.
-   **Model Training**: Fine-tune LLMs (Llama, Mistral, TinyLlama, etc.) with configurable hyperparameters (LoRA, quantization, epochs, etc.).
-   **Dataset Management**: Upload, clean (deduplicate), and manage datasets locally.
-   **Evaluation**: Automated evaluation of trained models against validation sets.
-   **Model History**: Track and re-use previously configured models.
-   **Dark Mode UI**: sleek, responsive interface.

## Prerequisites

-   **Node.js**: v18 or higher.
-   **Python**: v3.10 or higher.
-   **CUDA Toolkit** (Optional): For GPU acceleration (strongly recommended).
-   **LM Studio** (Optional but strongly recommended): Required for "Magic Import", "Magic Judge" and Synthetic Data generation features (LLM proxy).

## Installation

### 1. Backend Setup

The backend handles API requests, file management, and orchestration of Python training scripts.

\`\`\`bash
cd madlab-backend

# Install Node.js dependencies
npm install

# Setup Python Environment
# It is recommended to create a virtual environment inside 'trainer/'
cd trainer
python -m venv venv

# Activate Virtual Environment (Windows)
venv\Scripts\activate

# Install Python dependencies
# Note: For GPU support, ensure you install the correct PyTorch version for your CUDA availability.
pip install -r requirements.txt

# Return to backend root
cd ..

# Build the Typescript backend
npm run build
\`\`\`

### 2. Frontend Setup

The frontend provides the user interface.

\`\`\`bash
cd madlab-frontend

# Install dependencies
npm install
\`\`\`

### 3. Environment Configuration

Both the backend and frontend require environment configuration files.

#### Backend Configuration

Create a `.env` file in `madlab-backend/` (or copy from `.env.example`):

\`\`\`bash
cd madlab-backend
copy .env.example .env
\`\`\`

Edit the `.env` file to configure:
- `PORT`: Backend server port (default: 8080)
- `LM_STUDIO_URL`: URL of your LM Studio instance (default: http://192.168.0.73:1234)

#### Frontend Configuration

Create a `.env` file in `madlab-frontend/` (or copy from `.env.example`):

\`\`\`bash
cd madlab-frontend
copy .env.example .env
\`\`\`

Edit the `.env` file to configure:
- `VITE_API_URL`: Backend API URL (default: http://localhost:8080)
- `VITE_WS_URL`: WebSocket URL for real-time updates (default: ws://localhost:8080/events)

## Running the Application

### Start the Backend

Open a terminal in \`madlab-backend\`:

\`\`\`bash
npm start
\`\`\`

The server will start on \`http://localhost:8080\`.

### Start the Frontend

Open a new terminal in \`madlab-frontend\`:

\`\`\`bash
npm run dev
\`\`\`

The UI will typically be available at \`http://localhost:5173\`.

## Usage Guide

1.  **Select a Model**: Use the "Base Model" dropdown or browse HuggingFace to pick a model.
2.  **Prepare Data**:
    *   **Import**: Use "Magic Import" to pull datasets from HuggingFace and automatically format them.
    *   **Upload**: Upload your own \`.jsonl\` files.
    *   **Generate**: Generate \`.jsonl\` files from a few examples.
3.  **Configure**: Set epochs, batch size, learning rate, and target device (CUDA/CPU).
4.  **Train**: Click "Start Training". Monitoring logs will appear in real-time.
5.  **Evaluate**: 
    *   **Static**: Run static evaluations to check model performance.
    *   **Magic Judge**: Run Magic Judge to evaluate model performance against a validation set.
6.  **Convert**: Convert model to F16 GGUF format.
7.  **Quantize**: Quantize model to INT8 format.

## License

This project is licensed under the GNU General Public License v3.0 (GPLv3). See the \`LICENSE\` file for details.





