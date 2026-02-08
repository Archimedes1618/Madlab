import { spawn } from 'child_process';
import path from 'path';
import { promises as fsPromises } from 'fs';
import { broadcast } from '../server';
import { fetchWithTimeout } from '../utils/fetch';
import { CONFIG } from '../config';
import type { LMStudioResponse } from '../types';
import type { EvaluationSample, JudgmentResult, JudgedSample, StaticReport, JudgeReport } from './types/evaluation';
import { evaluateGGUF } from './ggufEvaluator';
import { generateGraph } from './visualization';
import { appendLineage } from './lineage';
import fs from 'fs';

function computeCapabilityIndex(
    rawJudgeScore: number,
    accuracy: number,
    samples: JudgedSample[],
    epsilon = 0.01
): { rawDepth: number; normalized: number } {
    let filteredSum = 0;
    let filteredCount = 0;

    for (const s of samples) {
        const score = s.judgment.score;
        const output = (s.output || "").trim();

        if (score === 10) continue; // skip parroting

        const invalid0 = score === 0 && (
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

    if (filteredCount === 0) return { rawDepth: 0, normalized: 0 };

    const judgeScore = filteredSum / filteredCount;
    const adjustedAccuracy = Math.max(epsilon, accuracy);

    let mu = 0.33, sigma = 0.15;
    if (judgeScore >= 8.0) { mu = 0.25; sigma = 0.10; }
    else if (judgeScore <= 7.9) { mu = 0.40; sigma = 0.20; }

    const exponent = -Math.pow(adjustedAccuracy - mu, 2) / (2 * Math.pow(sigma, 2));
    const penaltyFactor = Math.exp(exponent);
    const rawDepth = judgeScore * penaltyFactor;
    const normalized = Math.max(0, Math.min(100, (rawDepth / 2) * 10));

    return { rawDepth, normalized };
}

function parseJudgmentJson(content: string): JudgmentResult {
    let jsonStr = content.trim();
    
    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.substring(7);
    if (jsonStr.endsWith('```')) jsonStr = jsonStr.substring(0, jsonStr.length - 3);
    jsonStr = jsonStr.replace(/```/g, '').trim();

    try {
        return JSON.parse(jsonStr) as JudgmentResult;
    } catch {
        console.log(`[Judge] Raw content that failed parsing: ${jsonStr}`);
        
        const jsonMatch = jsonStr.match(/\{.*\}/s);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0]) as JudgmentResult;
            } catch {
                let fixedJson = jsonStr;
                const openBraces = (fixedJson.match(/{/g) || []).length;
                const closeBraces = (fixedJson.match(/}/g) || []).length;
                
                if (openBraces > closeBraces) {
                    fixedJson += '}'.repeat(openBraces - closeBraces);
                    return JSON.parse(fixedJson) as JudgmentResult;
                }
            }
        }
        throw new Error(`Failed to parse JSON: ${content}`);
    }
}

async function callLLMJudge(sample: EvaluationSample, sharpnessInstruction: string): Promise<JudgmentResult> {
    const prompt = `
    ${sharpnessInstruction}

    Task: Rate the AI Model output on a scale of 0 to 10 (10 being perfect).

    Input Prompt: "${sample.input}"

    Expected Target: "${sample.target}"

    Actual Model Output: "${sample.output}"

    Format your response as a JSON object: {"score": <number>, "reason": "<short explanation>"}
    RETURN ONLY JSON.`;

    const res = await fetchWithTimeout(`${CONFIG.LM_STUDIO_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            stream: false
        })
    }, CONFIG.LLM_TIMEOUT);

    if (!res.ok) throw new Error(`LM Studio API returned ${res.status}: ${res.statusText}`);

    const data = await res.json() as LMStudioResponse;
    if (!data.choices?.[0]?.message?.content) {
        throw new Error('Invalid response structure from LM Studio');
    }

    return parseJudgmentJson(data.choices[0].message.content);
}

export async function judgeModel(
    modelName: string,
    quantization: string,
    limit: number,
    sharpness: number
): Promise<JudgeReport> {
    broadcast({ type: 'status', payload: { message: `Magic Judge: Running static evaluation...` } });
    const staticReportPath = await evaluateGGUF(modelName, quantization, limit);

    console.log('[Judge] Loading static report from:', staticReportPath);
    const reportData = await fsPromises.readFile(staticReportPath, 'utf8');
    const staticReport = JSON.parse(reportData) as StaticReport;
    const samples = staticReport.samples;

    if (!samples?.length) throw new Error('No samples found in static report');

    // Separate correct from those needing judgment
    const correctSamples: JudgedSample[] = [];
    const toJudge: EvaluationSample[] = [];
    let totalScore = 0;

    for (const s of samples) {
        if (s.correct === true) {
            correctSamples.push({ ...s, judgment: { score: 10, reason: "Static match (skipped judge)" } });
            totalScore += 10;
        } else {
            toJudge.push(s);
        }
    }

    console.log(`[Judge] Static correct: ${correctSamples.length}, Needs judging: ${toJudge.length}`);
    broadcast({ type: 'status', payload: { message: `Magic Judge: Judging ${toJudge.length} samples with LLM...` } });

    // Sharpness-based instruction
    let sharpnessInstruction = "You are a balanced judge. Look for correct information and similar tone. Minor deviations are acceptable.";
    if (sharpness < 30) {
        sharpnessInstruction = "You are a lenient judge. Focus on creativity and flow. Even if the output deviates from the target, if it makes sense and is coherent, give it a high score.";
    } else if (sharpness > 70) {
        sharpnessInstruction = "You are a specific and strict judge. The output must closely match the target in style, tone, and content. Penalize deviations heavily.";
    }

    const judgedSamples: JudgedSample[] = [];
    const CONCURRENCY = 4;

    for (let i = 0; i < toJudge.length; i += CONCURRENCY) {
        const batch = toJudge.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
            batch.map(sample => callLLMJudge(sample, sharpnessInstruction))
        );

        results.forEach((result, idx) => {
            const sample = batch[idx];
            if (result.status === 'fulfilled') {
                judgedSamples.push({ ...sample, judgment: result.value });
                totalScore += result.value.score;
            } else {
                console.error('Judge Error', result.reason);
                judgedSamples.push({ ...sample, judgment: { score: 0, reason: "Judge Failed" } });
            }
        });

        const processed = Math.min(i + CONCURRENCY, toJudge.length);
        broadcast({ type: 'status', payload: { message: `Magic Judge: Rated ${processed}/${toJudge.length} samples...` } });
    }

    const allJudgedSamples = [...correctSamples, ...judgedSamples];
    const avgScore = totalScore / samples.length;
    const accuracy = staticReport.accuracy;
    const { rawDepth, normalized } = computeCapabilityIndex(avgScore, accuracy, allJudgedSamples);

    // Behavioral metrics
    const A_s = accuracy;
    const A_j = avgScore / 10;
    let P = Math.min(1, A_s / A_j);
    const N = 1 - P;
    const Q_label = 0.5 * A_s + 0.5 * A_j;
    const Q_free = A_j * (0.5 + 0.5 * N);

    console.log(`[Judge] P: ${P.toFixed(3)}, N: ${N.toFixed(3)}, Q_label: ${Q_label.toFixed(3)}, Q_free: ${Q_free.toFixed(3)}`);
    console.log(`[Judge] RDI raw: ${rawDepth.toFixed(3)}, normalized: ${normalized.toFixed(1)}`);

    broadcast({ type: 'status', payload: { message: `RDI Index: ${normalized.toFixed(1)} / 100` } });

    const judgeReport: JudgeReport = {
        model: modelName,
        quantization,
        sharpness,
        limit,
        average_score: avgScore,
        static_accuracy: accuracy,
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

    // Run Python plot script
    const venvPath = process.platform === 'win32' 
        ? path.join(CONFIG.TRAINER_DIR, 'venv', 'Scripts', 'python.exe')
        : path.join(CONFIG.TRAINER_DIR, 'venv', 'bin', 'python');

    // Use venv if it exists, otherwise fallback to system python
    const pythonPath = fs.existsSync(venvPath) ? venvPath : 'python';

    const child = spawn(pythonPath, [
        path.join(CONFIG.TRAINER_DIR, 'plot.py'),
        accuracy.toString(),
        avgScore.toString(),
        normalized.toString()
    ]);

    child.on('error', (err) => console.error(`[Plot Script] Failed to spawn: ${err.message}`));
    child.stdout.on('data', (data) => console.log(`[Plot Script] ${data}`));
    child.stderr.on('data', (data) => console.error(`[Plot Script Error] ${data}`));
    child.on('close', (code) => {
        if (code === 0) console.log('Model performance plot generated');
        else console.error('Failed to generate plot');
    });

    const graphPath = path.join(CONFIG.MODELS_DIR, `${modelName}-${quantization}-graph.png`);
    await generateGraph(judgeReport, graphPath);
    console.log(`[Judge] Graph saved to ${graphPath}`);

    broadcast({ type: 'status', payload: { message: `Graph generated: ${graphPath}` } });
    broadcast({ type: 'status', payload: { message: `Magic Judge Complete! Score: ${avgScore.toFixed(1)}/10` } });

    await appendLineage(modelName, 'judge_evaluation', {
        quantization, sharpness, limit, average_score: avgScore,
        static_accuracy: accuracy, capability_index: normalized
    });

    return judgeReport;
}
