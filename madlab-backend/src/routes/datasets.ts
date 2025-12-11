import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import yaml from 'js-yaml';
import { spawn } from 'child_process';
import { fetchWithTimeout } from '../utils/fetch';
import { sanitizePath, validateHFRepo, validateFilename } from '../utils/security';
import { MAX_FILE_SIZE_BYTES } from '../utils/validation';
import { CONFIG, getPythonPath } from '../config';
import type { VariationItem, ToolOutput, TrainingConfig } from '../types';

const router = express.Router();

// Ensure data directory exists
if (!fs.existsSync(CONFIG.DATA_DIR)) {
    fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
}

// Helper to prompt LLM for synthetic data generation
async function generateVariations(seedInput: string, seedOutput: string, count: number): Promise<VariationItem[]> {
    const prompt = `You are a synthetic data generator.
    I will provide a "Seed Example" of an Input/Output pair.
    Your task is to generate ${count} distinct variations of this example.

    Seed Input: "${seedInput}"
    Seed Output: "${seedOutput}"

    Output format: JSON array of objects with "input" and "target" keys.
    Example: [{"input": "...", "target": "..."}, ...]
    RETURN ONLY JSON.`;

    try {
        const res = await fetchWithTimeout(`${CONFIG.LM_STUDIO_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.8,
                stream: false
            })
        }, CONFIG.LLM_TIMEOUT);

        const data = await res.json() as { choices: Array<{ message: { content: string } }> };
        const content = data.choices[0].message.content;

        // Clean markdown if present
        const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error('Generation failed:', e);
        throw e;
    }
}

router.post('/generate', async (req, res) => {
    const { seedInput, seedOutput, count } = req.body;
    if (!seedInput || !seedOutput || !count) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing fields' } });
    }

    try {
        const variations = await generateVariations(seedInput, seedOutput, Math.min(count, 50));

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `generated_${timestamp}.jsonl`;
        const filePath = path.join(CONFIG.DATA_DIR, filename);

        const fileContent = variations.map((v: VariationItem) => JSON.stringify({ input: v.input, target: v.target })).join('\n');
        await fsPromises.writeFile(filePath, fileContent);

        res.json({ message: 'Dataset generated', filename, count: variations.length });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Generation failed';
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
});

// Helper to run data tools
const SCRIPT_PATH = path.join(CONFIG.TRAINER_DIR, 'data_tools.py');

function runTool(args: string[]): Promise<ToolOutput> {
    return new Promise((resolve, reject) => {
        const pythonExec = getPythonPath();
        const proc = spawn(pythonExec, [SCRIPT_PATH, ...args]);
        let output = '';
        let error = '';

        proc.stdout.on('data', d => output += d.toString());
        proc.stderr.on('data', d => error += d.toString());

        proc.on('close', code => {
            if (code !== 0) {
                try {
                    const lines = output.trim().split('\n');
                    const lastLine = JSON.parse(lines[lines.length - 1]);
                    if (lastLine.error) return reject(new Error(lastLine.error));
                } catch {
                    // Unable to parse error from output
                    console.error('Tool error (unparseable):', error);
                }
                return reject(new Error(error || 'Tool failed'));
            }
            try {
                const lines = output.trim().split('\n');
                const jsonLines = lines.filter(l => l.startsWith('{'));
                const lastLine = JSON.parse(jsonLines[jsonLines.length - 1]);
                resolve(lastLine);
            } catch {
                resolve({ message: 'Tool completed', raw: output });
            }
        });
    });
}

router.post('/import', async (req, res) => {
    const { repo, split } = req.body;
    if (!repo) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Repo required' } });
    }

    // Validate HF repo format
    if (!validateHFRepo(repo)) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid repository format. Expected: owner/repo' } });
    }

    try {
        const result = await runTool(['import', '--repo', repo, '--split', split || 'train', '--out_dir', CONFIG.DATA_DIR]);
        res.json(result);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Import failed';
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
});

router.post('/clean', async (req, res) => {
    const { filename } = req.body;
    if (!filename) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Filename required' } });
    }

    // Validate filename and prevent path traversal
    if (!validateFilename(filename)) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid filename' } });
    }

    try {
        const filePath = sanitizePath(CONFIG.DATA_DIR, filename);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
        }

        const result = await runTool(['clean', '--file', filePath]);
        res.json(result);
    } catch (e: unknown) {
        if (e instanceof Error && e.message.includes('traversal')) {
            return res.status(400).json({ error: { code: 'PATH_TRAVERSAL', message: 'Invalid path' } });
        }
        const message = e instanceof Error ? e.message : 'Clean failed';
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
});

// Smart Import Logic
router.post('/smart_import', async (req, res) => {
    const { repo, split } = req.body;
    if (!repo) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Repo required' } });
    }

    // Validate HF repo format
    if (!validateHFRepo(repo)) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid repository format. Expected: owner/repo' } });
    }

    try {
        // 1. Inspect
        const inspectRes = await runTool(['inspect', '--repo', repo, '--split', split || 'train']);
        if (inspectRes.error) throw new Error(inspectRes.error);
        if (!inspectRes.sample) throw new Error('Could not inspect dataset');

        // 2. Generate Transform with LLM
        const schema = JSON.stringify(inspectRes.sample, null, 2);
        const prompt = `
        You are a python expert. I have a dataset row that looks like this:
        ${schema}

        Write a Python function named 'transform_row(row)' that takes this dictionary 'row' and returns a NEW dictionary with exactly two keys: 'input' and 'target'.
        - 'input' should be the user prompt/instruction.
        - 'target' should be the desired response/output.
        - If the row is chat based, try to format input as "User: ... \\n" and target as the assistant response.
        - Return None if the row is invalid.
        - ONLY return the python code for the function. No markdown.
        `;

        const llmRes = await fetchWithTimeout(`${CONFIG.LM_STUDIO_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2,
                stream: false
            })
        }, CONFIG.LLM_TIMEOUT);

        const llmData = await llmRes.json() as { choices: Array<{ message: { content: string } }> };
        let code = llmData.choices[0].message.content;

        // Clean markdown
        code = code.replace(/```python/g, '').replace(/```/g, '').trim();

        // 3. Run Import with Script
        const result = await runTool(['import', '--repo', repo, '--split', split || 'train', '--out_dir', CONFIG.DATA_DIR, '--transform_script', code]);
        res.json({ ...result, transform_script: code });

    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Smart import failed';
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
});

router.delete('/:filename', async (req, res) => {
    const { filename } = req.params;
    if (!filename) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Filename required' } });
    }

    // Validate filename and prevent path traversal
    if (!validateFilename(filename)) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid filename' } });
    }

    try {
        const filePath = sanitizePath(CONFIG.DATA_DIR, filename);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
        }

        await fsPromises.unlink(filePath);
        res.json({ message: 'File deleted' });
    } catch (e: unknown) {
        if (e instanceof Error && e.message.includes('traversal')) {
            return res.status(400).json({ error: { code: 'PATH_TRAVERSAL', message: 'Invalid path' } });
        }
        const message = e instanceof Error ? e.message : 'Delete failed';
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
});

// Multer setup with file size limits
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, CONFIG.DATA_DIR);
    },
    filename: (_req, file, cb) => {
        // Sanitize filename
        const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
        cb(null, safeName);
    }
});
const upload = multer({
    storage,
    limits: {
        fileSize: MAX_FILE_SIZE_BYTES // 100MB max
    },
    fileFilter: (_req, file, cb) => {
        // Only allow .jsonl files
        if (file.originalname.endsWith('.jsonl')) {
            cb(null, true);
        } else {
            cb(new Error('Only .jsonl files are allowed'));
        }
    }
});

// GET /datasets
router.get('/', async (_req, res) => {
    try {
        const files = fs.readdirSync(CONFIG.DATA_DIR).filter(f => f.endsWith('.jsonl'));

        // Check current config to see which is active
        let currentDataset = '';
        if (fs.existsSync(CONFIG.CONFIG_PATH)) {
            const configFile = await fsPromises.readFile(CONFIG.CONFIG_PATH, 'utf8');
            const config = yaml.load(configFile) as TrainingConfig;
            if (config && config.data && config.data.path) {
                currentDataset = path.basename(config.data.path);
            }
        }

        const datasets = files.map(f => {
            const stats = fs.statSync(path.join(CONFIG.DATA_DIR, f));
            return {
                name: f,
                size: stats.size,
                selected: f === currentDataset,
                created: stats.birthtime
            };
        });
        res.json(datasets);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Failed to list datasets';
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
});

// POST /datasets/upload
router.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'No file uploaded' } });
    }
    res.json({ message: 'File uploaded successfully', filename: req.file.filename });
});

// POST /datasets/select
router.post('/select', async (req, res) => {
    const { filename } = req.body;
    if (!filename) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Filename required' } });
    }

    // Validate filename and prevent path traversal
    if (!validateFilename(filename)) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid filename' } });
    }

    try {
        const fullPath = sanitizePath(CONFIG.DATA_DIR, filename);
        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
        }

        // Update config
        const configFile = await fsPromises.readFile(CONFIG.CONFIG_PATH, 'utf8');
        const config = yaml.load(configFile) as TrainingConfig;
        config.data.path = `../data/${filename}`;

        await fsPromises.writeFile(CONFIG.CONFIG_PATH, yaml.dump(config), 'utf8');
        res.json({ message: 'Dataset selected', path: config.data.path });
    } catch (e: unknown) {
        if (e instanceof Error && e.message.includes('traversal')) {
            return res.status(400).json({ error: { code: 'PATH_TRAVERSAL', message: 'Invalid path' } });
        }
        const message = e instanceof Error ? e.message : 'Select failed';
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
});

export default router;
