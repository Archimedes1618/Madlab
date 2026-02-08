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
import { logEvent } from '../services/auditLogger';

const router = express.Router();
const VERSIONS_DIR = path.join(CONFIG.DATA_DIR, 'versions');
const MAX_VERSIONS = 5;

// Ensure directories exist
if (!fs.existsSync(CONFIG.DATA_DIR)) fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
if (!fs.existsSync(VERSIONS_DIR)) fs.mkdirSync(VERSIONS_DIR, { recursive: true });

// Version helpers
async function createVersion(filename: string): Promise<string | null> {
    const src = path.join(CONFIG.DATA_DIR, filename);
    if (!fs.existsSync(src)) return null;
    
    const name = path.basename(filename, '.jsonl');
    const versionDir = path.join(VERSIONS_DIR, name);
    if (!fs.existsSync(versionDir)) fs.mkdirSync(versionDir, { recursive: true });
    
    const timestamp = Date.now().toString();
    const content = await fsPromises.readFile(src, 'utf8');
    const rowCount = content.split('\n').filter(l => l.trim()).length;
    
    await fsPromises.writeFile(path.join(versionDir, `${timestamp}.jsonl`), content);
    await fsPromises.writeFile(path.join(versionDir, `${timestamp}.meta.json`), 
        JSON.stringify({ version: timestamp, timestamp, rowCount, source: filename }));
    
    // Cleanup old versions
    const versions = fs.readdirSync(versionDir).filter(f => f.endsWith('.jsonl')).sort().reverse();
    for (const old of versions.slice(MAX_VERSIONS)) {
        await fsPromises.unlink(path.join(versionDir, old)).catch(() => {});
        await fsPromises.unlink(path.join(versionDir, old.replace('.jsonl', '.meta.json'))).catch(() => {});
    }
    return timestamp;
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
    const start = Date.now();
    const { repo, split } = req.body;
    if (!repo) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Repo required' } });
    }

    // Validate HF repo format
    if (!validateHFRepo(repo)) {
        logEvent('dataset.import', { repo }, 'failure', Date.now() - start, 'invalid repo format');
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid repository format. Expected: owner/repo' } });
    }

    try {
        const result = await runTool(['import', '--repo', repo, '--split', split || 'train', '--out_dir', CONFIG.DATA_DIR]);
        logEvent('dataset.import', { repo, split: split || 'train' }, 'success', Date.now() - start);
        res.json(result);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Import failed';
        logEvent('dataset.import', { repo, split }, 'failure', Date.now() - start, message);
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

        await createVersion(filename); // version before clean
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
    const start = Date.now();
    const { filename } = req.params;
    if (!filename) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Filename required' } });
    }

    // Validate filename and prevent path traversal
    if (!validateFilename(filename)) {
        logEvent('dataset.delete', { filename }, 'failure', Date.now() - start, 'invalid filename');
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid filename' } });
    }

    try {
        const filePath = sanitizePath(CONFIG.DATA_DIR, filename);
        if (!fs.existsSync(filePath)) {
            logEvent('dataset.delete', { filename }, 'failure', Date.now() - start, 'not found');
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
        }

        await createVersion(filename); // version before delete
        await fsPromises.unlink(filePath);
        logEvent('dataset.delete', { filename }, 'success', Date.now() - start);
        res.json({ message: 'File deleted' });
    } catch (e: unknown) {
        if (e instanceof Error && e.message.includes('traversal')) {
            logEvent('dataset.delete', { filename }, 'failure', Date.now() - start, 'path traversal');
            return res.status(400).json({ error: { code: 'PATH_TRAVERSAL', message: 'Invalid path' } });
        }
        const message = e instanceof Error ? e.message : 'Delete failed';
        logEvent('dataset.delete', { filename }, 'failure', Date.now() - start, message);
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

// GET /datasets/:name/preview
router.get('/:name/preview', async (req, res) => {
    const { name } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 5, 20);

    if (!validateFilename(name)) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid filename' } });
    }

    try {
        const filePath = sanitizePath(CONFIG.DATA_DIR, name);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
        }

        const content = await fsPromises.readFile(filePath, 'utf8');
        const lines = content.trim().split('\n').filter(l => l.trim());
        const samples: any[] = [];
        const errors: string[] = [];
        const seen = new Set<string>();
        let totalInputLen = 0, totalOutputLen = 0;

        for (let i = 0; i < lines.length; i++) {
            try {
                const row = JSON.parse(lines[i]);
                const input = row.input ?? row.prompt ?? row.instruction ?? '';
                const target = row.target ?? row.output ?? row.response ?? '';
                const key = `${input}::${target}`;

                if (seen.has(key)) errors.push(`Row ${i + 1}: duplicate`);
                seen.add(key);
                if (!input.trim()) errors.push(`Row ${i + 1}: empty input`);
                if (!target.trim()) errors.push(`Row ${i + 1}: empty target`);
                if (target.trim().length < 10) errors.push(`Row ${i + 1}: very short target (${target.length} chars)`);

                totalInputLen += input.length;
                totalOutputLen += target.length;
                if (samples.length < limit) samples.push({ input, target });
            } catch { errors.push(`Row ${i + 1}: invalid JSON`); }
        }

        res.json({
            samples,
            stats: { rowCount: lines.length, avgInputLen: lines.length ? Math.round(totalInputLen / lines.length) : 0, avgOutputLen: lines.length ? Math.round(totalOutputLen / lines.length) : 0 },
            errors: errors.slice(0, 20)
        });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Preview failed';
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
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

// Convert different JSONL formats to input/target
function convertToStandardFormat(line: string): string | null {
    try {
        const row = JSON.parse(line);

        // Already has input/target
        if (row.input !== undefined && row.target !== undefined) {
            if (!row.input && !row.target) return null; // skip empty
            return JSON.stringify({ input: row.input, target: row.target });
        }

        // Conversations format (OpenAI/ShareGPT style)
        if (row.conversations && Array.isArray(row.conversations)) {
            const humanMsgs = row.conversations.filter((m: any) => m.from === 'human' || m.role === 'user');
            const gptMsgs = row.conversations.filter((m: any) => m.from === 'gpt' || m.from === 'assistant' || m.role === 'assistant');
            if (humanMsgs.length && gptMsgs.length) {
                const input = humanMsgs.map((m: any) => m.value || m.content).join('\n');
                const target = gptMsgs.map((m: any) => m.value || m.content).join('\n');
                if (input && target) return JSON.stringify({ input, target });
            }
            return null;
        }

        // Messages format (OpenAI chat)
        if (row.messages && Array.isArray(row.messages)) {
            const userMsgs = row.messages.filter((m: any) => m.role === 'user');
            const assistantMsgs = row.messages.filter((m: any) => m.role === 'assistant');
            if (userMsgs.length && assistantMsgs.length) {
                const input = userMsgs.map((m: any) => m.content).join('\n');
                const target = assistantMsgs.map((m: any) => m.content).join('\n');
                if (input && target) return JSON.stringify({ input, target });
            }
            return null;
        }

        // prompt/completion format
        if (row.prompt !== undefined || row.completion !== undefined) {
            const input = row.prompt || row.instruction || '';
            const target = row.completion || row.output || row.response || '';
            if (input && target) return JSON.stringify({ input, target });
            return null;
        }

        // instruction/output format
        if (row.instruction !== undefined || row.output !== undefined) {
            const input = row.instruction || '';
            const target = row.output || row.response || '';
            if (input && target) return JSON.stringify({ input, target });
            return null;
        }

        return null; // unknown format
    } catch {
        return null; // invalid JSON
    }
}

// POST /datasets/merge - merge multiple datasets into one
router.post('/merge', async (req, res) => {
    const start = Date.now();
    const { filenames } = req.body as { filenames: string[] };

    if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Filenames array required' } });
    }

    // Validate all filenames
    for (const f of filenames) {
        if (!validateFilename(f)) {
            return res.status(400).json({ error: { code: 'INVALID_INPUT', message: `Invalid filename: ${f}` } });
        }
    }

    try {
        const mergedName = `merged_${Date.now()}.jsonl`;
        const mergedPath = path.join(CONFIG.DATA_DIR, mergedName);
        const writeStream = fs.createWriteStream(mergedPath);
        let totalLines = 0;
        const skippedFiles: string[] = [];
        const fileStats: Record<string, { total: number; converted: number; skipped: number }> = {};

        for (const filename of filenames) {
            const fullPath = sanitizePath(CONFIG.DATA_DIR, filename);
            if (!fs.existsSync(fullPath)) {
                skippedFiles.push(`${filename}: not found`);
                continue;
            }

            const content = await fsPromises.readFile(fullPath, 'utf8');

            // Skip HTML/non-JSONL files
            if (content.trim().startsWith('<!') || content.trim().startsWith('<html')) {
                skippedFiles.push(`${filename}: not a JSONL file (HTML detected)`);
                continue;
            }

            const lines = content.trim().split('\n').filter(l => l.trim());
            const stats = { total: lines.length, converted: 0, skipped: 0 };

            for (const line of lines) {
                const converted = convertToStandardFormat(line);
                if (converted) {
                    writeStream.write(converted + '\n');
                    totalLines++;
                    stats.converted++;
                } else {
                    stats.skipped++;
                }
            }

            fileStats[filename] = stats;
            if (stats.converted === 0) {
                skippedFiles.push(`${filename}: no valid rows converted`);
            }
        }
        writeStream.end();

        if (totalLines === 0) {
            await fsPromises.unlink(mergedPath).catch(() => {});
            return res.status(400).json({
                error: { code: 'NO_VALID_DATA', message: 'No valid data found in any file' },
                skipped: skippedFiles,
                fileStats
            });
        }

        // Auto-select the merged file
        const configFile = await fsPromises.readFile(CONFIG.CONFIG_PATH, 'utf8');
        const config = yaml.load(configFile) as TrainingConfig;
        config.data.path = `../data/${mergedName}`;
        await fsPromises.writeFile(CONFIG.CONFIG_PATH, yaml.dump(config), 'utf8');

        logEvent('dataset.merge', { filenames, mergedName, totalLines }, 'success', Date.now() - start);
        res.json({
            message: 'Datasets merged',
            filename: mergedName,
            totalLines,
            skipped: skippedFiles,
            fileStats
        });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Merge failed';
        logEvent('dataset.merge', { filenames }, 'failure', Date.now() - start, message);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
});

// POST /datasets/select
router.post('/select', async (req, res) => {
    const start = Date.now();
    const { filename } = req.body;
    if (!filename) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Filename required' } });
    }

    // Validate filename and prevent path traversal
    if (!validateFilename(filename)) {
        logEvent('dataset.select', { filename }, 'failure', Date.now() - start, 'invalid filename');
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid filename' } });
    }

    try {
        const fullPath = sanitizePath(CONFIG.DATA_DIR, filename);
        if (!fs.existsSync(fullPath)) {
            logEvent('dataset.select', { filename }, 'failure', Date.now() - start, 'not found');
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
        }

        // Update config
        const configFile = await fsPromises.readFile(CONFIG.CONFIG_PATH, 'utf8');
        const config = yaml.load(configFile) as TrainingConfig;
        config.data.path = `../data/${filename}`;

        await fsPromises.writeFile(CONFIG.CONFIG_PATH, yaml.dump(config), 'utf8');
        logEvent('dataset.select', { filename }, 'success', Date.now() - start);
        res.json({ message: 'Dataset selected', path: config.data.path });
    } catch (e: unknown) {
        if (e instanceof Error && e.message.includes('traversal')) {
            logEvent('dataset.select', { filename }, 'failure', Date.now() - start, 'path traversal');
            return res.status(400).json({ error: { code: 'PATH_TRAVERSAL', message: 'Invalid path' } });
        }
        const message = e instanceof Error ? e.message : 'Select failed';
        logEvent('dataset.select', { filename }, 'failure', Date.now() - start, message);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
});

// Version management routes
router.get('/:name/versions', async (req, res) => {
    const name = req.params.name.replace('.jsonl', '');
    if (!validateFilename(name + '.jsonl')) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid name' } });
    
    const versionDir = path.join(VERSIONS_DIR, name);
    if (!fs.existsSync(versionDir)) return res.json([]);
    
    const versions = fs.readdirSync(versionDir).filter(f => f.endsWith('.meta.json'))
        .map(f => { try { return JSON.parse(fs.readFileSync(path.join(versionDir, f), 'utf8')); } catch { return null; } })
        .filter(Boolean).sort((a, b) => b.timestamp - a.timestamp);
    res.json(versions);
});

router.get('/:name/versions/:version', async (req, res) => {
    const name = req.params.name.replace('.jsonl', '');
    const { version } = req.params;
    if (!validateFilename(name + '.jsonl') || !/^\d+$/.test(version)) 
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid params' } });
    
    const versionFile = path.join(VERSIONS_DIR, name, `${version}.jsonl`);
    if (!fs.existsSync(versionFile)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Version not found' } });
    
    res.sendFile(versionFile);
});

router.post('/:name/rollback/:version', async (req, res) => {
    const name = req.params.name.replace('.jsonl', '');
    const { version } = req.params;
    if (!validateFilename(name + '.jsonl') || !/^\d+$/.test(version)) 
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid params' } });
    
    const versionFile = path.join(VERSIONS_DIR, name, `${version}.jsonl`);
    const targetFile = path.join(CONFIG.DATA_DIR, `${name}.jsonl`);
    if (!fs.existsSync(versionFile)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Version not found' } });
    
    await createVersion(`${name}.jsonl`); // backup current before rollback
    await fsPromises.copyFile(versionFile, targetFile);
    res.json({ message: 'Rolled back', version });
});


// POST /:name/analyze-quality - LLM-powered quality analysis
router.post('/:name/analyze-quality', async (req, res) => {
    const name = req.params.name.replace('.jsonl', '') + '.jsonl';
    if (!validateFilename(name)) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid name' } });
    
    const filePath = path.join(CONFIG.DATA_DIR, name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
    
    const content = await fsPromises.readFile(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    const samples = lines.map((l, i) => { try { return { idx: i, ...JSON.parse(l) }; } catch { return null; } }).filter(Boolean);
    
    const BATCH_SIZE = 5;
    const issues: Array<{row: number, score: number, reason: string}> = [];
    let totalScore = 0, analyzed = 0;
    
    // Build all batch prompts
    const batches: Array<{ idx: number; prompt: string }> = [];
    for (let i = 0; i < samples.length; i += BATCH_SIZE) {
        const batch = samples.slice(i, i + BATCH_SIZE);
        batches.push({
            idx: i,
            prompt: `Rate these training samples 1-10 for quality. Flag issues: contradictions, unclear instructions, wrong targets, typos.
Return JSON array: [{"idx": <row>, "score": <1-10>, "reason": "<issue or 'ok'>"}]

Samples:
${batch.map((s: any) => `Row ${s.idx}: input="${s.input?.slice(0, 200)}" target="${s.target?.slice(0, 200)}"`).join('\n')}

RETURN ONLY JSON.`
        });
    }

    // Process all batches in parallel
    const results = await Promise.allSettled(batches.map(async ({ idx, prompt }) => {
        const llmRes = await fetchWithTimeout(`${CONFIG.LM_STUDIO_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], temperature: 0.3, stream: false })
        }, 30000);
        const data = await llmRes.json() as { choices: Array<{ message: { content: string } }> };
        const jsonStr = data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
        return { idx, ratings: JSON.parse(jsonStr) as Array<{idx: number, score: number, reason: string}> };
    }));

    for (const result of results) {
        if (result.status === 'fulfilled') {
            for (const r of result.value.ratings) {
                totalScore += r.score;
                analyzed++;
                if (r.score < 7) issues.push({ row: r.idx, score: r.score, reason: r.reason });
            }
        } else {
            console.warn('Quality check batch failed:', result.reason);
        }
    }
    
    res.json({
        overall_score: analyzed ? Math.round((totalScore / analyzed) * 10) / 10 : 0,
        samples_analyzed: analyzed,
        issues: issues.slice(0, 50)
    });
});


// Augment dataset via LLM rewriting
router.post('/:name/augment', async (req, res) => {
    const name = req.params.name.replace('.jsonl', '');
    const { multiplier = 2, styles = ['formal', 'casual', 'concise'] } = req.body;
    if (!validateFilename(name + '.jsonl') || multiplier < 2 || multiplier > 4) 
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Bad params' } });

    const srcPath = path.join(CONFIG.DATA_DIR, `${name}.jsonl`);
    if (!fs.existsSync(srcPath)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });

    const { broadcast } = await import('../server');
    const lines = (await fsPromises.readFile(srcPath, 'utf8')).split('\n').filter(l => l.trim());
    const samples = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const seen = new Set(samples.map(s => s.input));
    const augmented: Array<{ input: string; target: string }> = [];

    const styleList = styles.slice(0, multiplier).join(', ');
    for (let i = 0; i < samples.length; i += 5) {
        const batch = samples.slice(i, i + 5);
        broadcast({ type: 'status', payload: { message: `Augmenting ${i}/${samples.length}...` } });

        // Parallelize batch processing
        const results = await Promise.allSettled(batch.map(async (s) => {
            const prompt = `Rewrite this input ${multiplier} ways (${styleList}). Keep target EXACTLY: "${s.target}"\nInput: "${s.input}"\nReturn JSON array: [{"input":"...","target":"${s.target}"},...]`;
            const r = await fetchWithTimeout(`${CONFIG.LM_STUDIO_URL}/v1/chat/completions`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], temperature: 0.7, stream: false })
            }, CONFIG.LLM_TIMEOUT);
            const data = await r.json() as { choices: Array<{ message: { content: string } }> };
            const json = data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
            return { target: s.target, items: JSON.parse(json) as Array<{ input: string; target: string }> };
        }));

        for (const result of results) {
            if (result.status === 'fulfilled') {
                for (const it of result.value.items) {
                    if (!seen.has(it.input)) { seen.add(it.input); augmented.push({ input: it.input, target: result.value.target }); }
                }
            }
        }
    }

    const outFile = `${name}_augmented.jsonl`;
    const outPath = path.join(CONFIG.DATA_DIR, outFile);
    const outLines = [...samples, ...augmented].map(s => JSON.stringify(s)).join('\n');
    await fsPromises.writeFile(outPath, outLines);
    broadcast({ type: 'status', payload: { message: `Augmentation done: ${augmented.length} new samples` } });
    res.json({ original_count: samples.length, augmented_count: samples.length + augmented.length, output_file: outFile });
});

export default router;
