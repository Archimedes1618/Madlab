// Type definitions for Madlab Backend

// Training Configuration
export interface TrainingConfig {
    model: {
        name: string;
        adapter: string;
        load_path: string;
        save_path: string;
    };
    data: {
        path: string;
        max_samples: number;
        val_split: number;
    };
    train: {
        epochs: number;
        batch_size: number;
        max_seq_len: number;
        lr: number;
        weight_decay: number;
        warmup_steps: number;
        grad_clip: number;
        log_every: number;
        save_every: number;
        val_every?: number;
    };
    runtime: {
        device: 'cuda' | 'cpu';
        workers: number;
    };
}

// Training Metrics (from Python stdout)
export interface TrainingMetrics {
    loss: number;
    grad_norm: number;
    learning_rate: number;
    epoch: number;
    step: number;
}

// Training Status
export interface TrainingStatus {
    running: boolean;
    pid?: number;
    code?: number;
    killed?: boolean;
}

// Dataset
export interface Dataset {
    name: string;
    size: number;
    selected: boolean;
    created: Date;
}

// Instillation Pair
export interface InstillationPair {
    id: string;
    trigger: string;
    match: {
        type: 'exact' | 'regex' | 'semantic';
        caseInsensitive?: boolean;
        normalizeWhitespace?: boolean;
    };
    response: string;
    createdAt: string;
    updatedAt: string;
    enabled: boolean;
}

// Instillations Data
export interface InstillationsData {
    version: string;
    pairs: InstillationPair[];
}

// WebSocket Message Types
export interface WSStatusMessage {
    type: 'status';
    payload: {
        message?: string;
        running?: boolean;
        pid?: number;
        code?: number;
        killed?: boolean;
    };
}

export interface WSTrainLogMessage {
    type: 'train-log';
    payload: TrainingMetrics | { stderr?: string; error?: string; raw?: string; message?: string };
}

export interface WSFileSizeMessage {
    type: 'file-size';
    payload: {
        file: string;
        size: number;
        timestamp: number;
    };
}

export type WebSocketMessage = WSStatusMessage | WSTrainLogMessage | WSFileSizeMessage;

// API Response Wrapper
export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
    };
}

// Error Codes
export const ErrorCodes = {
    PATH_TRAVERSAL: 'PATH_TRAVERSAL',
    INVALID_INPUT: 'INVALID_INPUT',
    NOT_FOUND: 'NOT_FOUND',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    UNAUTHORIZED: 'UNAUTHORIZED',
    RATE_LIMITED: 'RATE_LIMITED',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

// LM Studio Response
export interface LMStudioResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

// Tool Output (from Python scripts)
export interface ToolOutput {
    message?: string;
    error?: string;
    filename?: string;
    count?: number;
    schema?: string[];
    sample?: Record<string, unknown>;
    raw?: string;
}

// Conversion Job
export interface ConversionJob {
    modelName: string;
    quantization: string;
}

// Model Artifact
export interface ModelArtifact {
    name: string;
    url: string;
}

// HuggingFace Model
export interface HFModel {
    id: string;
    likes: number;
    downloads: number;
    tags: string[];
    pipeline_tag: string;
}

// Variation Response (from synthetic data generation)
export interface VariationItem {
    input: string;
    target: string;
}
