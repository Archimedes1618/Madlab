// Log types
export type LogType = 'system' | 'log' | 'error' | 'status';

export interface LogPayload {
    message?: string;
    loss?: number;
    grad_norm?: number;
    learning_rate?: number;
    epoch?: number;
    step?: number;
}

export interface LogLine {
    id: string;
    type: LogType | string;
    payload: string | LogPayload;
    timestamp: string;
}

// Metrics from training
export interface TrainingMetrics {
    loss?: number;
    grad_norm?: number;
    learning_rate?: number;
    epoch?: number;
    step?: number;
}

// Model artifacts
export interface ModelArtifact {
    name: string;
    url?: string;
    size?: number;
}

// Training configuration (aligned with backend types)
export interface TrainingConfig {
    model: {
        name: string;
        save_path: string;
        adapter?: string;
        load_path?: string;
    };
    data: {
        path: string;
        val_split: number;
        max_samples?: number;
    };
    train: {
        epochs: number;
        batch_size: number;
        lr: number;
        max_seq_len: number;
        weight_decay: number;
        warmup_steps: number;
        grad_clip: number;
        log_every: number;
        save_every: number;
        val_every?: number;
        grad_accum_steps: number;
        early_stopping_patience: number;
        save_total_limit: number;
        gradient_checkpointing: boolean;
        packing: boolean;
        save_best_only: boolean;
        lr_scheduler: string;
        optimizer: string;
    };
    precision: {
        fp16: boolean;
        bf16: boolean;
        fp32: boolean;
    };
    runtime: {
        device: 'cpu' | 'cuda';
        workers?: number;
    };
}

// Training status
export interface TrainingStatus {
    running: boolean;
    pid?: number;
}

// Dataset info
export interface DatasetInfo {
    name: string;
    size: number;
    selected: boolean;
    created: string;
}

// Chat message
export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}
