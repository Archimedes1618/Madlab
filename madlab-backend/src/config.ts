import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import fs from 'fs';

// Centralized configuration
export const CONFIG = {
    // Server
    PORT: parseInt(process.env.PORT || '8080', 10),

    // CORS
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173', 'http://localhost:3000'],

    // LM Studio
    LM_STUDIO_URL: process.env.LM_STUDIO_URL || 'http://localhost:1234',

    // Paths
    DATA_DIR: path.join(__dirname, '../data'),
    MODELS_DIR: path.join(__dirname, '../models'),
    TRAINER_DIR: path.join(__dirname, '../trainer'),
    CONFIG_PATH: path.join(__dirname, '../trainer/config/train.yaml'),
    HISTORY_PATH: path.join(__dirname, '../data/model_history.json'),
    INSTILLATIONS_PATH: path.join(__dirname, '../data/instillations.json'),

    // Timeouts (ms) - configurable via environment variables
    FETCH_TIMEOUT: parseInt(process.env.FETCH_TIMEOUT || '60000', 10),   // 60s default
    LLM_TIMEOUT: parseInt(process.env.LLM_TIMEOUT || '300000', 10),      // 5 min default

    // Rate Limiting - 120 req/min (~2 req/sec) for active usage while preventing abuse
    RATE_LIMIT_WINDOW_MS: 60 * 1000, // 1 minute
    RATE_LIMIT_MAX: 120,
} as const;

// Python paths
export function getPythonPath(): string {
    if (process.platform === 'win32') {
        const venvPythonWin = path.join(CONFIG.TRAINER_DIR, 'venv', 'Scripts', 'python.exe');
        if (fs.existsSync(venvPythonWin)) {
            return venvPythonWin;
        }
    } else {
        const venvPythonUnix = path.join(CONFIG.TRAINER_DIR, 'venv', 'bin', 'python');
        if (fs.existsSync(venvPythonUnix)) {
            return venvPythonUnix;
        }
    }

    // Fallback to system python if venv isn't found
    return 'python';
}
