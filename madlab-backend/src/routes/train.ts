import express from 'express';
import { promises as fsPromises } from 'fs';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { startTraining, stopTraining, getStatus, getQueue, enqueueJob, removeJob } from '../services/processManager';
import { buildDataset } from '../services/datasetBuilder';
import { convertToGGUF, evaluateGGUF, judgeModel } from '../services/modelConverter';
import { CONFIG } from '../config';
import { isValidQuantization, isValidSharpness, isValidEvalLimit, ALLOWED_QUANTIZATIONS } from '../utils/validation';
import { isPathSafe } from '../utils/security';
import type { TrainingConfig, ModelArtifact } from '../types';
import { logEvent } from '../services/auditLogger';

const router = express.Router();

// POST /train/start
router.post('/start', async (req, res) => {
    const start = Date.now();
    try {
        const { configPath } = req.body;

        if (configPath && !isPathSafe(configPath, 'config')) {
            logEvent('training.start', { configPath }, 'failure', Date.now() - start, 'invalid path');
            return res.status(400).json({ error: { code: 'INVALID_PATH', message: 'configPath must be within config/' } });
        }

        // 1. Build instillations dataset (separate from training data)
        const count = await buildDataset();
        console.log(`Instillations dataset: ${count} pairs (training uses data.path from config)`);

        // 2. Start training
        await startTraining(configPath || 'config/train.yaml');

        logEvent('training.start', { configPath: configPath || 'config/train.yaml' }, 'success', Date.now() - start);
        res.json({ message: 'Training started', datasetSize: count });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Training start failed';
        logEvent('training.start', { configPath: req.body.configPath }, 'failure', Date.now() - start, message);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
});

// POST /train/stop
router.post('/stop', async (_req, res) => {
    await stopTraining();
    logEvent('training.stop', {}, 'success');
    res.json({ message: 'Training stopped' });
});

// POST /train/enqueue
router.post('/enqueue', async (req, res) => {
    const { configPath } = req.body;
    if (configPath && !isPathSafe(configPath, 'config')) {
        return res.status(400).json({ error: { code: 'INVALID_PATH', message: 'configPath must be within config/' } });
    }
    const job = await enqueueJob(configPath || 'config/train.yaml');
    logEvent('training.enqueue', { jobId: job.id, configPath: job.configPath }, 'success');
    res.json(job);
});

// GET /train/queue
router.get('/queue', async (_req, res) => res.json(await getQueue()));

// DELETE /train/queue/:id
router.delete('/queue/:id', async (req, res) => {
    const removed = await removeJob(req.params.id);
    if (!removed) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found or already running' } });
    logEvent('training.dequeue', { jobId: req.params.id }, 'success');
    res.json({ message: 'Job removed' });
});

// GET /train/status
router.get('/status', (_req, res) => {
    res.json(getStatus());
});

// POST /train/convert
router.post('/convert', async (req, res) => {
    const start = Date.now();
    const { modelName, quantization } = req.body;
    const quant = quantization || 'q8_0';
    try {
        // Validate quantization type
        if (!isValidQuantization(quant)) {
            logEvent('model.convert', { modelName, quantization: quant }, 'failure', Date.now() - start, 'invalid quantization');
            return res.status(400).json({
                error: { code: 'INVALID_PARAM', message: `Invalid quantization. Allowed: ${ALLOWED_QUANTIZATIONS.join(', ')}` }
            });
        }

        await convertToGGUF({ modelName: modelName || 'tuned', quantization: quant });
        logEvent('model.convert', { modelName: modelName || 'tuned', quantization: quant }, 'success', Date.now() - start);
        res.json({ message: 'Conversion complete' });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Conversion failed';
        logEvent('model.convert', { modelName, quantization: quant }, 'failure', Date.now() - start, message);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
});

// POST /train/evaluate
router.post('/evaluate', async (req, res) => {
    try {
        const { modelName, quantization, limit } = req.body;
        const quant = quantization || 'q8_0';
        const limitNum = limit ? parseFloat(limit) : 1.0;

        // Validate quantization type
        if (!isValidQuantization(quant)) {
            return res.status(400).json({
                error: { code: 'INVALID_PARAM', message: `Invalid quantization. Allowed: ${ALLOWED_QUANTIZATIONS.join(', ')}` }
            });
        }

        // Validate limit (0.01 to 1.0)
        if (!isValidEvalLimit(limitNum)) {
            return res.status(400).json({
                error: { code: 'INVALID_PARAM', message: 'Limit must be between 0.01 and 1.0' }
            });
        }

        await evaluateGGUF(modelName || 'tuned', quant, limitNum);
        res.json({ message: 'Evaluation complete' });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Evaluation failed';
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
});

// POST /train/judge
router.post('/judge', async (req, res) => {
    try {
        const { modelName, quantization, limit, sharpness } = req.body;
        const quant = quantization || 'q8_0';
        const limitNum = limit ? parseFloat(limit) : 0.2;
        const sharpnessNum = sharpness ? parseInt(sharpness, 10) : 50;

        // Validate quantization type
        if (!isValidQuantization(quant)) {
            return res.status(400).json({
                error: { code: 'INVALID_PARAM', message: `Invalid quantization. Allowed: ${ALLOWED_QUANTIZATIONS.join(', ')}` }
            });
        }

        // Validate limit (0.01 to 1.0)
        if (!isValidEvalLimit(limitNum)) {
            return res.status(400).json({
                error: { code: 'INVALID_PARAM', message: 'Limit must be between 0.01 and 1.0' }
            });
        }

        // Validate sharpness (0-100)
        if (!isValidSharpness(sharpnessNum)) {
            return res.status(400).json({
                error: { code: 'INVALID_PARAM', message: 'Sharpness must be between 0 and 100' }
            });
        }

        // Run in background (don't await fully to return response)
        judgeModel(
            modelName || 'tuned',
            quant,
            limitNum,
            sharpnessNum
        ).catch(e => console.error('Judge Async Error:', e));

        res.json({ message: 'Magic Judge started' });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Judge start failed';
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
});

// POST /train/generate-test-cases - LLM-powered test case generation
router.post('/generate-test-cases', async (req, res) => {
    const start = Date.now();
    try {
        const { sample_inputs, count = 15 } = req.body as { sample_inputs: string[]; count?: number };
        
        if (!sample_inputs?.length) {
            return res.status(400).json({ error: { code: 'INVALID_PARAM', message: 'sample_inputs required' } });
        }
        
        const clampedCount = Math.min(Math.max(count, 10), 20);
        const prompt = `Given these training inputs:
${sample_inputs.slice(0, 5).map((s, i) => `${i + 1}. "${s}"`).join('\n')}

Generate ${clampedCount} challenging test variations. Include:
- typo: spelling errors, transposed letters
- edge_case: boundary conditions, empty/null-like inputs
- ambiguous: unclear phrasing, multiple interpretations
- adversarial: prompt injection attempts, malformed requests

Return ONLY valid JSON array:
[{"input": "...", "category": "typo"}, ...]`;

        const { fetchWithTimeout } = await import('../utils/fetch');
        const llmRes = await fetchWithTimeout(`${CONFIG.LM_STUDIO_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], temperature: 0.7, stream: false })
        }, CONFIG.LLM_TIMEOUT);

        if (!llmRes.ok) throw new Error(`LM Studio returned ${llmRes.status}`);
        
        const data = await llmRes.json() as { choices: { message: { content: string } }[] };
        const raw = data.choices?.[0]?.message?.content || '[]';
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        const test_cases = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

        // Save to file
        const outPath = path.join(CONFIG.DATA_DIR, 'test_cases.jsonl');
        await fsPromises.writeFile(outPath, test_cases.map((t: any) => JSON.stringify(t)).join('\n'), 'utf8');

        logEvent('test-cases.generate', { count: test_cases.length }, 'success', Date.now() - start);
        res.json({ test_cases, saved_to: outPath });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Test case generation failed';
        logEvent('test-cases.generate', {}, 'failure', Date.now() - start, message);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
});

// POST /train/analyze-failures - LLM-powered failure analysis
router.post('/analyze-failures', async (req, res) => {
    const { failures } = req.body as { failures: { input: string; expected: string; actual: string; score: number }[] };
    if (!failures?.length) return res.status(400).json({ error: { code: 'INVALID_PARAM', message: 'failures array required' } });

    const batches: typeof failures[] = [];
    for (let i = 0; i < failures.length; i += 10) batches.push(failures.slice(i, i + 10));

    const { fetchWithTimeout } = await import('../utils/fetch');

    const results = await Promise.allSettled(batches.map(async (batch) => {
        const prompt = `Analyze these model failures. For each, categorize as: training_gap (needs more examples), ambiguous (unclear input), knowledge_limit (beyond training scope), or other.

${batch.map((f, i) => `[${i + 1}] Input: "${f.input.slice(0, 200)}"
Expected: "${f.expected.slice(0, 200)}"
Actual: "${f.actual.slice(0, 200)}"
Score: ${f.score}`).join('\n\n')}

Return JSON array: [{"index": 1, "category": "...", "explanation": "...", "suggestion": "..."}]
RETURN ONLY JSON.`;

        const response = await fetchWithTimeout(`${CONFIG.LM_STUDIO_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], temperature: 0.2, stream: false })
        }, CONFIG.LLM_TIMEOUT);

        if (!response.ok) throw new Error(`LM Studio: ${response.status}`);
        const data = await response.json() as { choices?: { message?: { content?: string } }[] };
        const content = data.choices?.[0]?.message?.content || '[]';
        const parsed = JSON.parse(content.replace(/```json?|```/g, '').trim()) as { index: number; category: string; explanation: string; suggestion: string }[];
        return { batch, parsed };
    }));

    const analysis: { input: string; category: string; explanation: string; suggestion: string }[] = [];
    const summary: Record<string, number> = { training_gap: 0, ambiguous: 0, knowledge_limit: 0, other: 0 };

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const batch = batches[i];
        if (result.status === 'fulfilled') {
            for (const item of result.value.parsed) {
                const f = batch[item.index - 1];
                if (!f) continue;
                const cat = ['training_gap', 'ambiguous', 'knowledge_limit'].includes(item.category) ? item.category : 'other';
                analysis.push({ input: f.input, category: cat, explanation: item.explanation, suggestion: item.suggestion });
                summary[cat]++;
            }
        } else {
            console.error('Failure analysis batch error:', result.reason);
            for (const f of batch) {
                analysis.push({ input: f.input, category: 'other', explanation: 'Analysis failed', suggestion: 'Retry' });
                summary.other++;
            }
        }
    }

    res.json({ analysis, summary });
});

// GET /train/checkpoints - list available checkpoints
router.get('/checkpoints', async (_req, res) => {
    try {
        const checkpointsBase = path.join(CONFIG.MODELS_DIR, 'checkpoints');
        if (!fs.existsSync(checkpointsBase)) return res.json([]);
        const runDirs = (await fsPromises.readdir(checkpointsBase, { withFileTypes: true }))
            .filter(d => d.isDirectory()).map(d => d.name);
        const checkpoints = (await Promise.all(runDirs.map(async runId => {
            const runDir = path.join(checkpointsBase, runId);
            const files = (await fsPromises.readdir(runDir)).filter(f => f.endsWith('.pt'));
            return Promise.all(files.map(async f => {
                const filePath = path.join(runDir, f);
                const stat = await fsPromises.stat(filePath);
                return { runId, file: f, path: filePath, mtime: stat.mtime.toISOString() };
            }));
        }))).flat();
        res.json(checkpoints.sort((a, b) => b.mtime.localeCompare(a.mtime)));
    } catch (e: unknown) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : 'Failed to list checkpoints' } });
    }
});

// POST /train/resume - resume training from checkpoint
router.post('/resume', async (req, res) => {
    const start = Date.now();
    try {
        const { configPath, runId } = req.body;
        if (configPath && !isPathSafe(configPath, 'config')) {
            return res.status(400).json({ error: { code: 'INVALID_PATH', message: 'configPath must be within config/' } });
        }
        if (runId && !isPathSafe(runId, path.join(CONFIG.MODELS_DIR, 'checkpoints'))) {
            return res.status(400).json({ error: { code: 'INVALID_PATH', message: 'invalid runId' } });
        }
        const checkpointDir = path.join(CONFIG.MODELS_DIR, 'checkpoints', runId || 'default');
        if (!fs.existsSync(checkpointDir)) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No checkpoints found for run' } });
        }
        await startTraining(configPath || 'config/train.yaml', true);
        logEvent('training.resume', { configPath, runId }, 'success', Date.now() - start);
        res.json({ message: 'Training resumed from checkpoint' });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Resume failed';
        logEvent('training.resume', {}, 'failure', Date.now() - start, message);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
});

// GET /train/artifacts
router.get('/artifacts', async (_req, res) => {
    try {
        if (!fs.existsSync(CONFIG.MODELS_DIR)) {
            return res.json([]);
        }
        const files = fs.readdirSync(CONFIG.MODELS_DIR).filter(f =>
            f.endsWith('.gguf') || f.endsWith('.json') || f.endsWith('.png'));
        const artifacts: ModelArtifact[] = files.map(f => ({
            name: f,
            url: `/artifacts/${encodeURIComponent(f)}`
        }));
        res.json(artifacts);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Failed to list artifacts';
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
});

// GET /train/config
router.get('/config', async (_req, res) => {
    try {
        if (!fs.existsSync(CONFIG.CONFIG_PATH)) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Config not found' } });
        }
        const file = await fsPromises.readFile(CONFIG.CONFIG_PATH, 'utf8');
        const doc = yaml.load(file, { schema: yaml.JSON_SCHEMA }) as TrainingConfig;
        res.json(doc);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Failed to read config';
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
});

// Model History Logic
async function updateModelHistory(modelName: string): Promise<void> {
    try {
        let history: string[] = [];
        if (fs.existsSync(CONFIG.HISTORY_PATH)) {
            const data = await fsPromises.readFile(CONFIG.HISTORY_PATH, 'utf8');
            history = JSON.parse(data);
        }
        if (!history.includes(modelName)) {
            history.unshift(modelName);
            await fsPromises.writeFile(CONFIG.HISTORY_PATH, JSON.stringify(history.slice(0, 20)), 'utf8');
        }
    } catch (e) {
        console.error('Failed to update history', e);
    }
}

router.get('/history', async (_req, res) => {
    try {
        if (!fs.existsSync(CONFIG.HISTORY_PATH)) return res.json([]);
        const data = await fsPromises.readFile(CONFIG.HISTORY_PATH, 'utf8');
        res.json(JSON.parse(data));
    } catch {
        res.json([]);
    }
});

// POST /train/config
router.post('/config', async (req, res) => {
    const start = Date.now();
    try {
        const newConfig = req.body as TrainingConfig;

        // Validate critical fields
        const errors: string[] = [];
        if (newConfig.data?.max_samples !== undefined && newConfig.data.max_samples !== null) {
            if (!Number.isInteger(newConfig.data.max_samples) || newConfig.data.max_samples < 0) {
                errors.push('data.max_samples must be a non-negative integer');
            }
        }
        if (newConfig.train) {
            if (!Number.isInteger(newConfig.train.epochs) || newConfig.train.epochs < 1) {
                errors.push('train.epochs must be a positive integer');
            }
            if (!Number.isInteger(newConfig.train.batch_size) || newConfig.train.batch_size < 1) {
                errors.push('train.batch_size must be a positive integer');
            }
            if (typeof newConfig.train.lr !== 'number' || newConfig.train.lr <= 0) {
                errors.push('train.lr must be a positive number');
            }
        }
        if (errors.length > 0) {
            logEvent('config.update', { model: newConfig.model?.name }, 'failure', Date.now() - start, errors.join('; '));
            return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: errors.join('; ') } });
        }

        const yamlStr = yaml.dump(newConfig);
        await fsPromises.writeFile(CONFIG.CONFIG_PATH, yamlStr, 'utf8');

        // Update history
        if (newConfig.model && newConfig.model.name) {
            await updateModelHistory(newConfig.model.name);
        }

        logEvent('config.update', { model: newConfig.model?.name }, 'success', Date.now() - start);
        res.json({ message: 'Config updated' });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Failed to save config';
        logEvent('config.update', {}, 'failure', Date.now() - start, message);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
});

// POST /train/export-bundle - Stream ZIP with model, config, dataset
router.post('/export-bundle', async (req, res) => {
    const archiver = (await import('archiver')).default;
    try {
        const { modelName, quantization } = req.body;
        const quant = quantization || 'q8_0';
        const ggufPath = `${CONFIG.MODELS_DIR}/${modelName || 'tuned'}-${quant}.gguf`;

        if (!fs.existsSync(ggufPath)) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Model not found' } });
        }

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${modelName || 'tuned'}-bundle.zip"`);

        const archive = archiver('zip', { zlib: { level: 5 } });
        archive.pipe(res);

        // Add GGUF model
        archive.file(ggufPath, { name: `${modelName || 'tuned'}-${quant}.gguf` });

        // Add config if exists
        if (fs.existsSync(CONFIG.CONFIG_PATH)) {
            archive.file(CONFIG.CONFIG_PATH, { name: 'train.yaml' });
        }

        // Add selected dataset if exists
        const configContent = fs.existsSync(CONFIG.CONFIG_PATH) ? yaml.load(fs.readFileSync(CONFIG.CONFIG_PATH, 'utf8')) as any : null;
        const datasetPath = configContent?.data?.path ? `${CONFIG.TRAINER_DIR}/${configContent.data.path}` : null;
        if (datasetPath && fs.existsSync(datasetPath)) {
            archive.file(datasetPath, { name: 'dataset.jsonl' });
        }

        // Add metadata
        archive.append(JSON.stringify({
            model: modelName || 'tuned',
            quantization: quant,
            exportedAt: new Date().toISOString()
        }, null, 2), { name: 'metadata.json' });

        await archive.finalize();
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Export failed';
        if (!res.headersSent) {
            res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
        }
    }
});


// POST /train/suggest-hyperparams - LLM-powered hyperparameter advisor
router.post('/suggest-hyperparams', async (req, res) => {
    const { model_name, dataset_rows, sample_data, gpu_vram_gb } = req.body;
    const prompt = `You are an ML training expert. Given:
- Model: ${model_name || 'unknown'}
- Dataset rows: ${dataset_rows || 'unknown'}
- GPU VRAM: ${gpu_vram_gb || 'unknown'}GB
- Sample data: ${JSON.stringify((sample_data || []).slice(0, 2))}

Suggest optimal training hyperparameters. Return ONLY valid JSON:
{"epochs":N,"learning_rate":N,"batch_size":N,"warmup_ratio":N,"grad_accum_steps":N,"reasoning":"brief explanation"}`;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const resp = await fetch(`${CONFIG.LM_STUDIO_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens: 256
            }),
            signal: controller.signal
        });
        clearTimeout(timeout);
        if (!resp.ok) throw new Error(`LM Studio error: ${resp.status}`);
        const data = await resp.json();
        const content = data.choices?.[0]?.message?.content || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON in response');
        res.json(JSON.parse(jsonMatch[0]));
    } catch (e: unknown) {
        res.status(500).json({ error: { code: 'LLM_ERROR', message: e instanceof Error ? e.message : 'Failed to get suggestions' } });
    }
});

export default router;
