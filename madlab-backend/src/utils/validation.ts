// Validation constants and helpers

// Allowed quantization types for GGUF conversion
export const ALLOWED_QUANTIZATIONS = ['f16', 'q8_0', 'q5_0', 'q4_0'] as const;
export type QuantizationType = typeof ALLOWED_QUANTIZATIONS[number];

// Sharpness bounds for Magic Judge
export const MIN_SHARPNESS = 0;
export const MAX_SHARPNESS = 100;

// Generation limits
export const MAX_GENERATE_COUNT = 50;
export const MIN_GENERATE_COUNT = 1;

// File upload limits
export const MAX_FILE_SIZE_MB = 100;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// Evaluation limit bounds
export const MIN_EVAL_LIMIT = 0.01;
export const MAX_EVAL_LIMIT = 1.0;

// Validation helpers
export function isValidQuantization(value: string): value is QuantizationType {
    return ALLOWED_QUANTIZATIONS.includes(value as QuantizationType);
}

export function isValidSharpness(value: number): boolean {
    return !isNaN(value) && value >= MIN_SHARPNESS && value <= MAX_SHARPNESS;
}

export function isValidEvalLimit(value: number): boolean {
    return !isNaN(value) && value >= MIN_EVAL_LIMIT && value <= MAX_EVAL_LIMIT;
}
