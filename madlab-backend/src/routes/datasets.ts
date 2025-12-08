import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';

import fetch from 'node-fetch'; // Ensure node-fetch is available

const router = express.Router();
const UPSTREAM_URL = process.env.LM_STUDIO_URL || 'http://localhost:1234';

// Helper to prompt LLM
async function generateVariations(seedInput: string, seedOutput: string, count: number) {
    const prompt = `You are a synthetic data generator. 
    I will provide a "Seed Example" of an Input/Output pair. 
    Your task is to generate ${count} distinct variations of this example.
    
    Seed Input: "${seedInput}"
    Seed Output: "${seedOutput}"
    
    Output format: JSON array of objects with "input" and "target" keys.
    Example: [{"input": "...", "target": "..."}, ...]
    RETURN ONLY JSON.`;

    try {
        const res = await fetch(`${UPSTREAM_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.8, // High creativity
                stream: false
            })
        });
        const data = await res.json();
        const content = data.choices[0].message.content;

        // Naive parsing - clean markdown if present
        const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error('Generation failed:', e);
        throw e;
    }
}

router.post('/generate', async (req, res) => {
    const { seedInput, seedOutput, count } = req.body;
    if (!seedInput || !seedOutput || !count) return res.status(400).json({ error: 'Missing fields' });

    try {
        const variations = await generateVariations(seedInput, seedOutput, Math.min(count, 50)); // Limit for now

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `generated_${timestamp}.jsonl`;
        const filePath = path.join(DATA_DIR, filename);

        const fileContent = variations.map((v: any) => JSON.stringify({ input: v.input, target: v.target })).join('\n');
        fs.writeFileSync(filePath, fileContent);

        res.json({ message: 'Dataset generated', filename, count: variations.length });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Helper to run data tools
import { spawn } from 'child_process';

const PYTHON_PATH = path.join(__dirname, '../../trainer/venv/Scripts/python.exe');
const SCRIPT_PATH = path.join(__dirname, '../../trainer/data_tools.py');

function runTool(args: string[]): Promise<any> {
    return new Promise((resolve, reject) => {
        const proc = spawn(PYTHON_PATH, [SCRIPT_PATH, ...args]);
        let output = '';
        let error = '';

        proc.stdout.on('data', d => output += d.toString());
        proc.stderr.on('data', d => error += d.toString());

        proc.on('close', code => {
            if (code !== 0) {
                // Try to parse error from stdout if it's JSON
                try {
                    const lines = output.trim().split('\n');
                    const lastLine = JSON.parse(lines[lines.length - 1]);
                    if (lastLine.error) return reject(new Error(lastLine.error));
                } catch { }
                return reject(new Error(error || 'Tool failed'));
            }
            try {
                // Find the last JSON line
                const lines = output.trim().split('\n');
                // Filter for JSON lines
                const jsonLines = lines.filter(l => l.startsWith('{'));
                const lastLine = JSON.parse(jsonLines[jsonLines.length - 1]);
                resolve(lastLine);
            } catch (e) {
                resolve({ message: 'Tool completed', raw: output });
            }
        });
    });
}

router.post('/import', async (req, res) => {
    const { repo, split } = req.body;
    if (!repo) return res.status(400).json({ error: 'Repo required' });

    try {
        const result = await runTool(['import', '--repo', repo, '--split', split || 'train', '--out_dir', DATA_DIR]);
        res.json(result);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/clean', async (req, res) => {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'Filename required' });

    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    try {
        const result = await runTool(['clean', '--file', filePath]);
        res.json(result);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Smart Import Logic
router.post('/smart_import', async (req, res) => {
    const { repo, split } = req.body;
    if (!repo) return res.status(400).json({ error: 'Repo required' });

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
        - If the row is chat based, try to format input as "User: ... \n" and target as the assistant response.
        - Return None if the row is invalid.
        - ONLY return the python code for the function. No markdown.
        `;

        const llmRes = await fetch(`${UPSTREAM_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2, // Low temp for code
                stream: false
            })
        });
        const llmData = await llmRes.json();
        let code = llmData.choices[0].message.content;

        // Clean markdown
        code = code.replace(/```python/g, '').replace(/```/g, '').trim();

        // 3. Run Import with Script
        const result = await runTool(['import', '--repo', repo, '--split', split || 'train', '--out_dir', DATA_DIR, '--transform_script', code]);
        res.json({ ...result, transform_script: code });

    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.delete('/:filename', (req, res) => {
    const { filename } = req.params;
    if (!filename) return res.status(400).json({ error: 'Filename required' });

    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    try {
        fs.unlinkSync(filePath);
        res.json({ message: 'File deleted' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Config file path
const CONFIG_PATH = path.join(__dirname, '../../trainer/config/train.yaml');

// Multer setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, DATA_DIR);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage });

// GET /datasets
router.get('/', (req, res) => {
    try {
        const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.jsonl'));

        // Check current config to see which is active
        let currentDataset = '';
        if (fs.existsSync(CONFIG_PATH)) {
            const config = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8')) as any;
            if (config && config.data && config.data.path) {
                currentDataset = path.basename(config.data.path);
            }
        }

        const datasets = files.map(f => {
            const stats = fs.statSync(path.join(DATA_DIR, f));
            return {
                name: f,
                size: stats.size,
                selected: f === currentDataset,
                created: stats.birthtime
            };
        });
        res.json(datasets);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// POST /datasets/upload
router.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ message: 'File uploaded successfully', filename: req.file.filename });
});

// POST /datasets/select
router.post('/select', (req, res) => {
    const { filename } = req.body;
    if (!filename) {
        return res.status(400).json({ error: 'Filename required' });
    }

    const fullPath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    try {
        // Update config
        const config = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8')) as any;
        config.data.path = `../data/${filename}`; // Relative to trainer/train.py ? Or absolute? 
        // train.py is in trainer/, data is in ../data relative to trainer?
        // Let's assume standard relative path from wherever train.py is run.
        // If train.py is run from trainer/, and data is in root/data:
        // root/trainer/train.py -> ../data/dataset.jsonl

        // Wait, DATA_DIR here is computed as path.join(__dirname, '../../data').
        // If __dirname is dist/routes, then ../../data is dist/data.
        // But train.py runs from trainer/ folder (source).
        // If we are in dev/build:
        // structure:
        // madlab-backend/
        //   data/ (where we save files)
        //   dist/
        //     routes/
        //   trainer/
        //     train.py

        // So from trainer/train.py to data/ is ../data/.

        // NOTE: The previous default was ../dist/data/dataset.jsonl or similar.
        // Let's standardize on using absolute paths if possible, or robust relative.
        // For now, let's try strict relative to the trainer directory.
        // If valid file is at <PROJECT_ROOT>/data/file.jsonl
        // And runner is <PROJECT_ROOT>/trainer/train.py
        // We verify the file exists at DATA_DIR.
        // The path in YAML should be relative to trainer dir: ../data/${filename}

        config.data.path = `../data/${filename}`;

        fs.writeFileSync(CONFIG_PATH, yaml.dump(config), 'utf8');
        res.json({ message: 'Dataset selected', path: config.data.path });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
