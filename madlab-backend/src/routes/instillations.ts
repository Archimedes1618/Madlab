import express from 'express';
import fs from 'fs/promises';
import safe from 'safe-regex2';
import { CONFIG } from '../config';
import { invalidateCache, getInstillations } from '../services/instillationsCache';
import type { InstillationPair, InstillationsData } from '../types';

// Validates regex: must be syntactically valid and not vulnerable to ReDoS
function validateRegex(pattern: string): string | null {
    try { new RegExp(pattern); } catch { return 'Invalid regex syntax'; }
    if (!safe(pattern)) return 'Regex vulnerable to ReDoS (exponential backtracking)';
    return null;
}

const router = express.Router();

// Read-write lock: serializes all file operations to prevent races
let fileLock = Promise.resolve();

// Helper to read data under lock
async function readData(): Promise<InstillationsData> {
    return new Promise((resolve) => {
        fileLock = fileLock.then(async () => {
            try {
                const data = await fs.readFile(CONFIG.INSTILLATIONS_PATH, 'utf-8');
                resolve(JSON.parse(data));
            } catch {
                resolve({ version: '1.0', pairs: [] });
            }
        }).catch(() => resolve({ version: '1.0', pairs: [] }));
    });
}

// Helper for read-modify-write under lock
async function modifyData(fn: (data: InstillationsData) => InstillationsData | Promise<InstillationsData>): Promise<InstillationsData> {
    return new Promise((resolve, reject) => {
        fileLock = fileLock.then(async () => {
            try {
                let data: InstillationsData;
                try {
                    const raw = await fs.readFile(CONFIG.INSTILLATIONS_PATH, 'utf-8');
                    data = JSON.parse(raw);
                } catch {
                    data = { version: '1.0', pairs: [] };
                }
                data = await fn(data);
                await fs.writeFile(CONFIG.INSTILLATIONS_PATH, JSON.stringify(data, null, 2));
                invalidateCache();
                resolve(data);
            } catch (err) {
                reject(err);
            }
        }).catch(reject);
    });
}

// GET /instillations
router.get('/', async (_req, res) => {
    const data = await readData();
    res.json(data);
});

// GET /instillations/export - Export all instillations
router.get('/export', async (_req, res) => {
    const data = await readData();
    res.json({ exportedAt: new Date().toISOString(), pairs: data.pairs });
});

// POST /instillations/import - Import instillations (skip duplicates by trigger)
router.post('/import', async (req, res) => {
    const { pairs } = req.body;
    if (!Array.isArray(pairs)) return res.status(400).json({ error: { code: 'INVALID_FORMAT', message: 'Expected { pairs: [...] }' } });

    // Validate all regex patterns first
    for (const p of pairs) {
        if (p.match?.type === 'regex') {
            const err = validateRegex(p.trigger);
            if (err) return res.status(400).json({ error: { code: 'INVALID_REGEX', message: `${err} in trigger: ${p.trigger}` } });
        }
    }

    let imported = 0, skipped = 0;
    await modifyData((data) => {
        const existingTriggers = new Set(data.pairs.map(p => p.trigger));
        for (const p of pairs) {
            if (existingTriggers.has(p.trigger)) { skipped++; continue; }
            data.pairs.push({
                ...p,
                id: crypto.randomUUID(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
            existingTriggers.add(p.trigger);
            imported++;
        }
        return data;
    });
    res.json({ imported, skipped });
});

// POST /instillations
router.post('/', async (req, res) => {
    if (req.body.match?.type === 'regex') {
        const err = validateRegex(req.body.trigger);
        if (err) return res.status(400).json({ error: { code: 'INVALID_REGEX', message: err } });
    }

    const pair: InstillationPair = {
        ...req.body,
        id: req.body.id || crypto.randomUUID() || Math.random().toString(36).substring(2) + Date.now().toString(36),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    try {
        await modifyData((data) => {
            data.pairs.push(pair);
            return data;
        });
        res.json(pair);
    } catch (err) {
        res.status(500).json({ error: { code: 'WRITE_ERROR', message: 'Failed to save' } });
    }
});

// PUT /instillations/:id
router.put('/:id', async (req, res) => {
    if (req.body.match?.type === 'regex' && req.body.trigger) {
        const err = validateRegex(req.body.trigger);
        if (err) return res.status(400).json({ error: { code: 'INVALID_REGEX', message: err } });
    }

    try {
        let updated: InstillationPair | null = null;
        await modifyData((data) => {
            const idx = data.pairs.findIndex(p => p.id === req.params.id);
            if (idx === -1) return data;
            data.pairs[idx] = { ...data.pairs[idx], ...req.body, updatedAt: new Date().toISOString() };
            updated = data.pairs[idx];
            return data;
        });
        if (!updated) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
        }
        res.json(updated);
    } catch {
        res.status(500).json({ error: { code: 'WRITE_ERROR', message: 'Failed to save' } });
    }
});

// DELETE /instillations/:id
router.delete('/:id', async (req, res) => {
    try {
        let deleted: InstillationPair | null = null;
        await modifyData((data) => {
            const idx = data.pairs.findIndex(p => p.id === req.params.id);
            if (idx === -1) return data;
            deleted = data.pairs.splice(idx, 1)[0];
            return data;
        });
        if (!deleted) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
        }
        res.json(deleted);
    } catch {
        res.status(500).json({ error: { code: 'WRITE_ERROR', message: 'Failed to delete' } });
    }
});

// POST /resolve - Check overrides (uses cache for performance)
router.post('/resolve', async (req, res) => {
    const { input } = req.body;
    if (!input) return res.json({ response: null });

    const data = await getInstillations();
    const activePairs = data.pairs.filter(p => p.enabled);

    for (const pair of activePairs) {
        let trigger = pair.trigger;
        let userInput = input;

        if (pair.match.normalizeWhitespace) {
            trigger = trigger.trim().replace(/\s+/g, ' ');
            userInput = userInput.trim().replace(/\s+/g, ' ');
        }

        if (pair.match.caseInsensitive) {
            trigger = trigger.toLowerCase();
            userInput = userInput.toLowerCase();
        }

        if (pair.match.type === 'exact') {
            if (userInput === trigger) {
                return res.json({ response: pair.response, matchedId: pair.id });
            }
        } else if (pair.match.type === 'regex') {
            try {
                const re = new RegExp(pair.trigger, pair.match.caseInsensitive ? 'i' : '');
                if (re.test(userInput)) {
                    return res.json({ response: pair.response, matchedId: pair.id });
                }
            } catch (regexErr) {
                console.warn('Invalid regex pattern:', pair.trigger, regexErr);
            }
        }
    }

    res.json({ response: null });
});

export default router;
