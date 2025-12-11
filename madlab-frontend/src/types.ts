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
    id: number;
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

export interface MonitoringState {
    logs: LogLine[];
    metrics: TrainingMetrics;
    files: Record<string, number>;
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

// Instillation types
export interface InstillationMatch {
    type: 'exact' | 'regex' | 'semantic';
    caseInsensitive?: boolean;
    normalizeWhitespace?: boolean;
}

export interface Instillation {
    id: string;
    trigger: string;
    match: InstillationMatch;
    response: string;
    enabled: boolean;
}

// Chat message
export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

// API Error response
export interface ApiError {
    error: {
        code: string;
        message: string;
    };
}
