// Shared types for evaluation modules

export interface EvaluationSample {
    input: string;
    target: string;
    output: string;
    correct: boolean;
}

export interface JudgmentResult {
    score: number;
    reason: string;
}

export interface StaticReport {
    accuracy: number;
    total_samples: number;
    correct_samples: number;
    samples: EvaluationSample[];
}

export interface JudgedSample extends EvaluationSample {
    judgment: JudgmentResult;
}

export interface JudgeReport {
    model: string;
    quantization: string;
    sharpness: number;
    limit: number;
    average_score: number;
    static_accuracy: number;
    capability_raw_depth: number;
    capability_index: number;
    repetition_fraction: number;
    derivation_fraction: number;
    quality_label: number;
    quality_derivation: number;
    samples: JudgedSample[];
}
