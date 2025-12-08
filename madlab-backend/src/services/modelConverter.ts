import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { broadcast } from '../server';

const TRAINER_DIR = path.join(__dirname, '../../trainer');
const MODELS_DIR = path.join(__dirname, '../../models');

interface ConversionJob {
    modelName: string;
    quantization: string;
}

export async function convertToGGUF(job: ConversionJob) {
    console.log(`Starting conversion for ${job.modelName} to ${job.quantization}`);
    broadcast({ type: 'status', payload: { message: `Converting ${job.modelName} to ${job.quantization}...` } });

    // 1. Detect Python (same logic as processManager, ideally refactor to shared util)
    let pythonExec = 'python';
    const venvPythonWin = path.join(TRAINER_DIR, 'venv', 'Scripts', 'python.exe');
    if (fs.existsSync(venvPythonWin)) {
        pythonExec = venvPythonWin;
    }

    // 2. Paths
    // The HF model is in dist/models/tuned (or whatever config said)
    // Wait, the config said ../models/tuned. 
    // Let's assume standard path for now or pass it in. 
    // For this MVP, we look in models/tuned
    const hfPath = path.join(MODELS_DIR, 'tuned');
    const ggufFilename = `${job.modelName}-${job.quantization}.gguf`;
    const ggufPath = path.join(MODELS_DIR, ggufFilename);

    const scriptPath = path.join(TRAINER_DIR, 'convert_hf_to_gguf.py');

    // Command: python convert_hf_to_gguf.py hf_path --outfile gguf_path --outtype q8_0
    const args = [
        scriptPath,
        hfPath,
        '--outfile', ggufPath,
        '--outtype', job.quantization
    ];

    return new Promise<void>((resolve, reject) => {
        const proc = spawn(pythonExec, args, { cwd: TRAINER_DIR });

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

    let pythonExec = 'python';
    const venvPythonWin = path.join(TRAINER_DIR, 'venv', 'Scripts', 'python.exe');
    if (fs.existsSync(venvPythonWin)) {
        pythonExec = venvPythonWin;
    }

    const ggufPath = path.join(MODELS_DIR, `${modelName}-${quantization}.gguf`);

    // Determine testset path: 
    const DATA_DIR = path.join(__dirname, '../../data');
    let testsetPath = path.join(DATA_DIR, 'val.jsonl');
    if (!fs.existsSync(testsetPath)) {
        testsetPath = path.join(DATA_DIR, 'dataset.jsonl'); // Legacy fallback
    }

    const reportFilename = `${modelName}-${quantization}-report.json`;
    const reportPath = path.join(MODELS_DIR, reportFilename);

    const scriptPath = path.join(TRAINER_DIR, 'evaluate_gguf.py');

    // Args: gguf, testset, out, --limit X
    const args = [scriptPath, ggufPath, testsetPath, reportPath];
    if (limit < 1.0) {
        args.push('--limit', limit.toString());
    }

    return new Promise<string>((resolve, reject) => {
        const proc = spawn(pythonExec, args, { cwd: TRAINER_DIR });

        proc.stdout.on('data', (data) => {
            const str = data.toString();
            try {
                const obj = JSON.parse(str);
                if (obj.message) {
                    broadcast({ type: 'status', payload: { message: obj.message } });
                }
            } catch (e) { }
            console.log('[Evaluator]', str);
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
import fetch from 'node-fetch';
const UPSTREAM_URL = process.env.LM_STUDIO_URL || 'http://localhost:1234';

export async function judgeModel(modelName: string, quantization: string, limit: number, sharpness: number) {
    // 1. Run static evaluation first (restricted by limit)
    broadcast({ type: 'status', payload: { message: `Magic Judge: Running static evaluation...` } });
    const staticReportPath = await evaluateGGUF(modelName, quantization, limit);

    // 2. Load results
    console.log('[Judge] Loading static report from:', staticReportPath);
    const staticReport = JSON.parse(fs.readFileSync(staticReportPath, 'utf8'));
    const samples = staticReport.samples;

    console.log('[Judge] Loaded report with', samples?.length || 0, 'samples');

    if (!samples || samples.length === 0) {
        throw new Error('No samples found in static report');
    }

    broadcast({ type: 'status', payload: { message: `Magic Judge: Judging ${samples.length} samples with LLM...` } });

    // 3. Prepare System Prompt based on Sharpness
    // Sharpness 0 (Lax) -> "Be creative, if it captures the essence it's good."
    // Sharpness 100 (Harsh) -> "Strictly match the style and content."

    let sharpnessInstruction = "";
    if (sharpness < 30) {
        sharpnessInstruction = "You are a lenient judge. Focus on creativity and flow. Even if the output deviates from the target, if it makes sense and is coherent, give it a high score.";
    } else if (sharpness > 70) {
        sharpnessInstruction = "You are a specific and strict judge. The output must closely match the target in style, tone, and content. Penalize deviations heavily.";
    } else {
        sharpnessInstruction = "You are a balanced judge. Look for correct information and similar tone. Minor deviations are acceptable.";
    }

    const judgedSamples = [];
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
            const res = await fetch(`${UPSTREAM_URL}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.1,
                    stream: false
                })
            });

            if (!res.ok) {
                throw new Error(`LM Studio API returned ${res.status}: ${res.statusText}`);
            }

            const data: any = await res.json();

            // Debug log the response structure
            console.log('[Judge Debug] LM Studio response:', JSON.stringify(data, null, 2));

            // Check if response has expected structure
            if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
                throw new Error(`Invalid response structure from LM Studio: ${JSON.stringify(data)}`);
            }

            if (!data.choices[0].message || !data.choices[0].message.content) {
                throw new Error(`Missing message content in response: ${JSON.stringify(data.choices[0])}`);
            }

            const content = data.choices[0].message.content;
            const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
            const judgment = JSON.parse(jsonStr);

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

    const judgePath = path.join(MODELS_DIR, `${modelName}-${quantization}-judge.json`);
    fs.writeFileSync(judgePath, JSON.stringify(judgeReport, null, 2));

    broadcast({ type: 'status', payload: { message: `Magic Judge Complete! Score: ${avgScore.toFixed(1)}/10` } });
    return judgeReport;
}
