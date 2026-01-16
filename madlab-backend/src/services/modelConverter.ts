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

// Helper function to compute capability index with improved algorithm
function computeCapabilityIndex(
    rawJudgeScore: number,
    accuracy: number,
    samples: Array<EvaluationSample & { judgment: JudgmentResult }>,
    epsilon = 0.01
): { rawDepth: number; normalized: number } {
    // 1. Filter out 10/10 scores (parroting)
    //    And optionally filter invalid 0/10 scores
    let filteredSum = 0;
    let filteredCount = 0;

    for (const s of samples) {
        const score = s.judgment.score;
        const output = (s.output || "").trim();

        // Skip parroting
        if (score === 10) continue;

        // Skip invalid 0/10 outputs (broken models)
        const invalid0 =
            score === 0 &&
            (
                output.length === 0 ||
                output === "null" ||
                output === "N/A" ||
                output.startsWith("{") ||
                output.startsWith("[") ||
                output.toLowerCase().includes("error") ||
                output.toLowerCase().includes("exception")
            );

        if (invalid0) continue;

        filteredSum += score;
        filteredCount++;
    }

    // If everything was filtered, capability = 0
    if (filteredCount === 0) {
        return { rawDepth: 0, normalized: 0 };
    }

    // 2. Compute filtered judge score
    const judgeScore = filteredSum / filteredCount;

    // 3. Apply Gaussian penalty curve
    const adjustedAccuracy = Math.max(epsilon, accuracy);

    let mu = 0.33;
    let sigma = 0.15;

    if (judgeScore >= 8.0) {
        mu = 0.25;
        sigma = 0.10;
    } else if (judgeScore <= 7.9) {
        mu = 0.40;
        sigma = 0.20;
    }

    const exponent = -Math.pow(adjustedAccuracy - mu, 2) / (2 * Math.pow(sigma, 2));
    const penaltyFactor = Math.exp(exponent);

    const rawDepth = judgeScore * penaltyFactor;

    const normalized = Math.max(0, Math.min(100, (rawDepth / 2) * 10));

    return { rawDepth, normalized };
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

    // Get converter from installed packages
    const scriptPath = path.join(CONFIG.TRAINER_DIR, 'venv', 'Lib', 'site-packages', 'bin', 'convert_hf_to_gguf.py');

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
): Promise<any> {
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

    // Separate correct samples (skip judge) from those needing judgment
    const correctSamples: Array<EvaluationSample & { judgment: JudgmentResult }> = [];
    const toJudge: EvaluationSample[] = [];
    let totalScore = 0;

    for (const s of samples) {
        if (s.correct === true) {
            const judgment = {
                score: 10,
                reason: "Static match (skipped judge)"
            };
            correctSamples.push({ ...s, judgment });
            totalScore += judgment.score; // count skipped as perfect
        } else {
            toJudge.push(s);
        }
    }

    console.log(`[Judge] Static correct: ${correctSamples.length}`);
    console.log(`[Judge] Needs judging: ${toJudge.length}`);

    broadcast({ type: 'status', payload: { message: `Magic Judge: Judging ${toJudge.length} samples with LLM...` } });

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

    for (let i = 0; i < toJudge.length; i++) {
        const s = toJudge[i];
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
            
            // Enhanced JSON parsing with robust error recovery for truncated responses
            let jsonStr = content.trim();
            
            // Remove markdown code blocks if present
            if (jsonStr.startsWith('```json')) {
                jsonStr = jsonStr.substring(7); // Remove ```json
            }
            if (jsonStr.endsWith('```')) {
                jsonStr = jsonStr.substring(0, jsonStr.length - 3); // Remove ```
            }
            
            // Clean up any remaining markdown formatting
            jsonStr = jsonStr.replace(/```/g, '').trim();
            
            // Try to parse with error recovery for truncated JSON
            let judgment: JudgmentResult;
            try {
                judgment = JSON.parse(jsonStr) as JudgmentResult;
            } catch (parseError) {
                // If parsing fails due to incomplete JSON, try to fix it
                console.log(`[Judge] Raw content that failed parsing: ${jsonStr}`);
                
                // Try to find and extract valid JSON from the content
                const jsonMatch = jsonStr.match(/\{.*\}/s);
                if (jsonMatch) {
                    try {
                        judgment = JSON.parse(jsonMatch[0]) as JudgmentResult;
                        console.log('[Judge] Successfully extracted JSON from truncated response');
                    } catch {
                        // If still failing, try to manually fix common issues
                        let fixedJson = jsonStr;
                        
                        // Count opening and closing braces
                        const openBraces = (fixedJson.match(/{/g) || []).length;
                        const closeBraces = (fixedJson.match(/}/g) || []).length;
                        
                        // If more opening than closing, add missing closing braces
                        if (openBraces > closeBraces) {
                            const missing = openBraces - closeBraces;
                            fixedJson += '}'.repeat(missing);
                            
                            try {
                                judgment = JSON.parse(fixedJson) as JudgmentResult;
                                console.log('[Judge] Successfully fixed truncated JSON by adding closing braces');
                            } catch (fixedError) {
                                // If still failing, use fallback with zero score
                                console.error('Failed to fix JSON even after adding braces:', fixedError);
                                throw new Error(`Failed to parse JSON after all recovery attempts: ${parseError}`);
                            }
                        } else {
                            throw new Error(`Failed to parse JSON after all recovery attempts: ${parseError}`);
                        }
                    }
                } else {
                    // If no JSON-like content found, create fallback
                    console.error('No valid JSON found in response:', jsonStr);
                    throw new Error(`Failed to extract valid JSON from response: ${jsonStr}`);
                }
            }

            judgedSamples.push({ ...s, judgment });
            totalScore += judgment.score;

            // Log/Broadcast progress
            if ((i + 1) % 5 === 0) {
                broadcast({ type: 'status', payload: { message: `Magic Judge: Rated ${i + 1}/${toJudge.length} samples...` } });
            }

        } catch (e) {
            console.error('Judge Error', e);
            judgedSamples.push({ ...s, judgment: { score: 0, reason: "Judge Failed" } });
        }
    }

    // Merge skipped + judged-incorrect
    const allJudgedSamples = [...correctSamples, ...judgedSamples];

    // Average over ALL samples (skipped + judged)
    const avgScore = totalScore / samples.length;
    
    // Compute capability index with improved algorithm
    const accuracy = staticReport.accuracy;
    const { rawDepth, normalized } = computeCapabilityIndex(avgScore, accuracy, allJudgedSamples);

    // --- 1. Compute new metrics right after CI ---

    // A_s = static accuracy
    const A_s = accuracy;

    // A_j = normalized judge accuracy (0–1)
    const A_j = avgScore / 10;

    // Parrot fraction P = A_s / A_j  (clamped to 1)
    let P = A_s / A_j;
    if (P > 1) P = 1;

    // Free‑thinker fraction N = 1 - P
    const N = 1 - P;

    // Label‑aligned quality (simple blend)
    const Q_label = 0.5 * A_s + 0.5 * A_j;

    // Free‑thinker quality (judge score boosted by N)
    const Q_free = A_j * (0.5 + 0.5 * N);

    // Log behavioral fractions
    console.log(`[Judge] Repetition Fraction (P): ${P.toFixed(3)}`);
    console.log(`[Judge] Derivation Fraction (N): ${N.toFixed(3)}`);

    // Log quality axes
    console.log(`[Judge] Label-Aligned Quality (Q_label): ${Q_label.toFixed(3)}`);
    console.log(`[Judge] Derivation Quality (Q_free): ${Q_free.toFixed(3)}`);

    // Log RDI (formerly Capability Index)
    console.log(`[Judge] RDI Depth (raw): ${rawDepth.toFixed(3)}`);
    console.log(`[Judge] RDI Index (0-100): ${normalized.toFixed(1)}`);

    // Broadcast RDI
    broadcast({
        type: 'status',
        payload: {
            message: `RDI Index: ${normalized.toFixed(1)} / 100`
        }
    });

    // 4. Save Final Report
    const judgeReport = {
        model: modelName,
        quantization,
        sharpness,
        limit,
        average_score: avgScore,
        static_accuracy: staticReport.accuracy,
        capability_raw_depth: rawDepth,
        capability_index: normalized,
        repetition_fraction: P,
        derivation_fraction: N,
        quality_label: Q_label,
        quality_derivation: Q_free,
        samples: allJudgedSamples
    };

    const judgePath = path.join(CONFIG.MODELS_DIR, `${modelName}-${quantization}-judge.json`);
    await fsPromises.writeFile(judgePath, JSON.stringify(judgeReport, null, 2));

    // Generate graph
    const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
    async function generateGraph(judgeReport: any, outputPath: string) {
        const width = 1000;
        const height = 600;
        const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

        const data = {
            labels: ['Model'],
            datasets: [
                {
                    label: 'Static Accuracy',
                    data: [judgeReport.static_accuracy],
                    backgroundColor: 'rgba(255, 165, 0, 0.6)',
                    yAxisID: 'y1'
                },
                {
                    label: 'MagicJudge Score',
                    data: [judgeReport.average_score],
                    backgroundColor: 'rgba(66, 135, 245, 0.6)',
                    yAxisID: 'y2'
                },
                {
                    label: 'RDI',
                    data: [judgeReport.capability_index],
                    backgroundColor: 'rgba(120, 220, 120, 0.6)',
                    yAxisID: 'y3'
                },
                {
                    label: 'Label-Aligned Quality',
                    data: [judgeReport.quality_label],
                    backgroundColor: 'rgba(200, 120, 255, 0.6)',
                    yAxisID: 'y4'
                },
                {
                    label: 'Derivation Quality',
                    data: [judgeReport.quality_derivation],
                    backgroundColor: 'rgba(255, 80, 150, 0.6)',
                    yAxisID: 'y5'
                }
            ]
        };

        const config = {
            type: 'bar',
            data,
            options: {
                plugins: {
                    title: {
                        display: true,
                        text: `Model Evaluation Graph: ${judgeReport.model}-${judgeReport.quantization}`,
                        font: { size: 22 }
                    }
                },
                scales: {
                    y1: {
                        type: 'linear',
                        position: 'left',
                        min: 0,
                        max: 1,
                        title: { display: true, text: 'Static Accuracy' }
                    },
                    y2: {
                        type: 'linear',
                        position: 'left',
                        min: 0,
                        max: 10,
                        title: { display: true, text: 'MagicJudge Score' }
                    },
                    y3: {
                        type: 'linear',
                        position: 'right',
                        min: 0,
                        max: 100,
                        title: { display: true, text: 'Repetition ↔ Derivation Index' },
                        grid: { drawOnChartArea: false },
                        ticks: {
                            callback: function(value: number) {
                                if (value === 0) return 'Pure Repetition';
                                if (value === 25) return 'Mostly Repetition';
                                if (value === 5) return 'Balanced';
                                if (value === 75) return 'Mostly Derivation';
                                if (value === 100) return 'Pure Derivation';
                                return '';
                            }
                        }
                    },
                    y4: {
                        type: 'linear',
                        position: 'right',
                        min: 0,
                        max: 1,
                        title: { display: true, text: 'Label-Aligned Quality (Q_label)' },
                        grid: { drawOnChartArea: false }
                    },
                    y5: {
                        type: 'linear',
                        position: 'right',
                        min: 0,
                        max: 1,
                        title: { display: true, text: 'Derivation Quality (Q_free)' },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        };
        const buffer = await chartJSNodeCanvas.renderToBuffer(config);
        await fsPromises.writeFile(outputPath, buffer);
    }

    // Now call Python script with dynamic data
    const pythonPath = path.join(CONFIG.TRAINER_DIR, 'venv', 'Scripts', 'python.exe'); // Python executable path

    const child = spawn(pythonPath, [
        path.join(CONFIG.TRAINER_DIR, 'plot.py'),
        accuracy.toString(),
        avgScore.toString(),
        normalized.toString()
    ]);

    child.stdout.on('data', (data) => {
        console.log(`[Plot Script] ${data}`);
    });

    child.stderr.on('data', (data) => {
        console.error(`[Plot Script Error] ${data}`);
    });

    child.on('close', (code) => {
        if (code === 0) {
            console.log('Model performance plot generated successfully');
        } else {
            console.error('Failed to generate plot');
        }
    });

    const graphPath = path.join(CONFIG.MODELS_DIR, `${modelName}-${quantization}-graph.png`);
    await generateGraph(judgeReport, graphPath);
    console.log(`[Judge] Graph saved to ${graphPath}`);
    broadcast({
        type: 'status',
        payload: { message: `Graph generated: ${graphPath}` }
    });
    broadcast({ type: 'status', payload: { message: `Magic Judge Complete! Score: ${avgScore.toFixed(1)}/10` } });
    return judgeReport;
}
