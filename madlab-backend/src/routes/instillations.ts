import express from 'express';
import fs from 'fs/promises';
import { CONFIG } from '../config';
import { invalidateCache, getInstillations } from '../services/instillationsCache';
import type { InstillationPair, InstillationsData } from '../types';

const router = express.Router();

// Write lock to prevent race conditions on concurrent writes
let writeLock = Promise.resolve();

// Helper to read data
async function readData(): Promise<InstillationsData> {
    try {
        const data = await fs.readFile(CONFIG.INSTILLATIONS_PATH, 'utf-8');
        return JSON.parse(data);
    } catch {
        return { version: '1.0', pairs: [] };
    }
}

// Helper to write data - uses lock to prevent race conditions, invalidates cache after write
async function writeData(data: InstillationsData): Promise<void> {
    const writeOperation = writeLock.then(async () => {
        await fs.writeFile(CONFIG.INSTILLATIONS_PATH, JSON.stringify(data, null, 2));
        invalidateCache();
    });
    writeLock = writeOperation.catch(() => {}); // Prevent lock from breaking on error
    return writeOperation;
}

// GET /instillations
router.get('/', async (_req, res) => {
    const data = await readData();
    res.json(data);
});

// POST /instillations
router.post('/', async (req, res) => {
    const pair: InstillationPair = {
        ...req.body,
        id: req.body.id || crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    // Simple UUID fallback if crypto not global (Node < 19)
    if (!pair.id) {
        pair.id = Math.random().toString(36).substring(2) + Date.now().toString(36);
    }

    const data = await readData();
    data.pairs.push(pair);
    await writeData(data);
    res.json(pair);
});

// PUT /instillations/:id
router.put('/:id', async (req, res) => {
    const data = await readData();
    const idx = data.pairs.findIndex(p => p.id === req.params.id);
    if (idx === -1) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
    data.pairs[idx] = { ...data.pairs[idx], ...req.body, updatedAt: new Date().toISOString() };
    await writeData(data);
    res.json(data.pairs[idx]);
});

// DELETE /instillations/:id
router.delete('/:id', async (req, res) => {
    const data = await readData();
    const idx = data.pairs.findIndex(p => p.id === req.params.id);
    if (idx === -1) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
    const deleted = data.pairs.splice(idx, 1);
    await writeData(data);
    res.json(deleted[0]);
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
