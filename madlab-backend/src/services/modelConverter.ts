import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import { broadcast } from '../server';
import { fetchWithTimeout } from '../utils/fetch';
import { CONFIG, getPythonPath } from '../config';
import type { ConversionJob, LMStudioResponse } from '../types';

interface EvaluationSample {
    input: string;
    target: string;
    output: string;
    correct: boolean;
}

interface StaticReport {
    accuracy: number;
    total_samples: number;
    correct_samples: number;
    samples: EvaluationSample[];
}

interface JudgmentResult {
    score: number;
    reason: string;
}

export async function convertToGGUF(job: ConversionJob): Promise<void> {
    console.log(`Starting conversion for ${job.modelName} to ${job.quantization}`);
    broadcast({ type: 'status', payload: { message: `Converting ${job.modelName} to ${job.quantization}...` } });

    // Ensure models directory exists
    await fsPromises.mkdir(CONFIG.MODELS_DIR, { recursive: true });

    const pythonExec = getPythonPath();
    const hfPath = path.join(CONFIG.MODELS_DIR, 'tuned');
    const ggufFilename = `${job.modelName}-${job.quantization}.gguf`;
    const ggufPath = path.join(CONFIG.MODELS_DIR, ggufFilename);
    const scriptPath = path.join(CONFIG.TRAINER_DIR, 'convert_hf_to_gguf.py');

    const args = [
        scriptPath,
        hfPath,
        '--outfile', ggufPath,
        '--outtype', job.quantization
    ];

    return new Promise<void>((resolve, reject) => {
        const proc = spawn(pythonExec, args, { cwd: CONFIG.TRAINER_DIR });

        proc.stdout.on('data', (data) => {
            console.log('[Converter]', data.toString());
        });

        proc.stderr.on('data', (data) => {
            console.error('[Converter Error]', data.toString());
        });

        proc.on('close', (code) => {
            if (code === 0) {
                console.log('Conversion successful');
                broadcast({ type: 'status', payload: { message: `Conversion complete: ${ggufFilename}` } });
                resolve();
            } else {
                reject(new Error(`Conversion failed with code ${code}`));
            }
        });
    });
}

export async function evaluateGGUF(modelName: string, quantization: string, limit: number = 1.0): Promise<string> {
    console.log(`Starting evaluation for ${modelName} ${quantization} (limit: ${limit})`);
    broadcast({ type: 'status', payload: { message: `Evaluating ${modelName}-${quantization}...` } });

    // Ensure models directory exists for report output
    await fsPromises.mkdir(CONFIG.MODELS_DIR, { recursive: true });

    const pythonExec = getPythonPath();
    const ggufPath = path.join(CONFIG.MODELS_DIR, `${modelName}-${quantization}.gguf`);

    // Determine testset path
    let testsetPath = path.join(CONFIG.DATA_DIR, 'val.jsonl');
    if (!fs.existsSync(testsetPath)) {
        testsetPath = path.join(CONFIG.DATA_DIR, 'dataset.jsonl');
    }

    const reportFilename = `${modelName}-${quantization}-report.json`;
    const reportPath = path.join(CONFIG.MODELS_DIR, reportFilename);
    const scriptPath = path.join(CONFIG.TRAINER_DIR, 'evaluate_gguf.py');

    const args = [scriptPath, ggufPath, testsetPath, reportPath];
    if (limit < 1.0) {
        args.push('--limit', limit.toString());
    }

    return new Promise<string>((resolve, reject) => {
        const proc = spawn(pythonExec, args, { cwd: CONFIG.TRAINER_DIR });

        proc.stdout.on('data', (data) => {
            const str = data.toString();
            try {
                const obj = JSON.parse(str);
                if (obj.message) {
                    broadcast({ type: 'status', payload: { message: obj.message } });
                }
            } catch {
                // Not JSON, just log
                console.log('[Evaluator]', str);
            }
        });

        proc.stderr.on('data', (data) => console.error('[Evaluator Err]', data.toString()));

        proc.on('close', (code) => {
            if (code === 0) {
                resolve(reportPath);
            } else {
                reject(new Error(`Evaluation failed with code ${code}`));
            }
        });
    });
}

// Magic Judge Logic
export async function judgeModel(
    modelName: string,
    quantization: string,
    limit: number,
    sharpness: number
): Promise<{ average_score: number }> {
    // 1. Run static evaluation first (restricted by limit)
    broadcast({ type: 'status', payload: { message: `Magic Judge: Running static evaluation...` } });
    const staticReportPath = await evaluateGGUF(modelName, quantization, limit);

    // 2. Load results
    console.log('[Judge] Loading static report from:', staticReportPath);
    const reportData = await fsPromises.readFile(staticReportPath, 'utf8');
    const staticReport = JSON.parse(reportData) as StaticReport;
    const samples = staticReport.samples;

    console.log('[Judge] Loaded report with', samples?.length || 0, 'samples');

    if (!samples || samples.length === 0) {
        throw new Error('No samples found in static report');
    }

    broadcast({ type: 'status', payload: { message: `Magic Judge: Judging ${samples.length} samples with LLM...` } });

    // 3. Prepare System Prompt based on Sharpness
    let sharpnessInstruction = "";
    if (sharpness < 30) {
        sharpnessInstruction = "You are a lenient judge. Focus on creativity and flow. Even if the output deviates from the target, if it makes sense and is coherent, give it a high score.";
    } else if (sharpness > 70) {
        sharpnessInstruction = "You are a specific and strict judge. The output must closely match the target in style, tone, and content. Penalize deviations heavily.";
    } else {
        sharpnessInstruction = "You are a balanced judge. Look for correct information and similar tone. Minor deviations are acceptable.";
    }

    const judgedSamples: Array<EvaluationSample & { judgment: JudgmentResult }> = [];
    let totalScore = 0;

    for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const prompt = `
        ${sharpnessInstruction}

        Task: Rate the AI Model output on a scale of 0 to 10 (10 being perfect).

        Input Prompt: "${s.input}"

        Expected Target: "${s.target}"

        Actual Model Output: "${s.output}"

        Format your response as a JSON object: {"score": <number>, "reason": "<short explanation>"}
        RETURN ONLY JSON.`;

        try {
            const res = await fetchWithTimeout(`${CONFIG.LM_STUDIO_URL}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.1,
                    stream: false
                })
            }, CONFIG.LLM_TIMEOUT);

            if (!res.ok) {
                throw new Error(`LM Studio API returned ${res.status}: ${res.statusText}`);
            }

            const data = await res.json() as LMStudioResponse;

            if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
                throw new Error(`Invalid response structure from LM Studio`);
            }

            if (!data.choices[0].message || !data.choices[0].message.content) {
                throw new Error(`Missing message content in response`);
            }

            const content = data.choices[0].message.content;
            const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
            const judgment = JSON.parse(jsonStr) as JudgmentResult;

            judgedSamples.push({ ...s, judgment });
            totalScore += judgment.score;

            // Log/Broadcast progress
            if ((i + 1) % 5 === 0) {
                broadcast({ type: 'status', payload: { message: `Magic Judge: Rated ${i + 1}/${samples.length} samples...` } });
            }

        } catch (e) {
            console.error('Judge Error', e);
            judgedSamples.push({ ...s, judgment: { score: 0, reason: "Judge Failed" } });
        }
    }

    const avgScore = totalScore / samples.length;

    // 4. Save Final Report
    const judgeReport = {
        model: modelName,
        quantization,
        sharpness,
        limit,
        average_score: avgScore,
        static_accuracy: staticReport.accuracy,
        samples: judgedSamples
    };

    const judgePath = path.join(CONFIG.MODELS_DIR, `${modelName}-${quantization}-judge.json`);
    await fsPromises.writeFile(judgePath, JSON.stringify(judgeReport, null, 2));

    broadcast({ type: 'status', payload: { message: `Magic Judge Complete! Score: ${avgScore.toFixed(1)}/10` } });
    return judgeReport;
}
