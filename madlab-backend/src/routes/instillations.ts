import express from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = express.Router();
const DATA_FILE = path.join(__dirname, '../data/instillations.json');

// Interface for Instillation Pair
interface InstillationPair {
    id: string;
    trigger: string;
    match: {
        type: 'exact' | 'regex' | 'semantic';
        caseInsensitive?: boolean;
        normalizeWhitespace?: boolean;
    };
    response: string;
    createdAt: string;
    updatedAt: string;
    enabled: boolean;
}

interface InstillationsData {
    version: string;
    pairs: InstillationPair[];
}

// Helper to read data
async function readData(): Promise<InstillationsData> {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (err) {
        // If file doesn't exist, return default
        return { version: '1.0', pairs: [] };
    }
}

// Helper to write data
async function writeData(data: InstillationsData) {
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

// GET /instillations
router.get('/', async (req, res) => {
    const data = await readData();
    res.json(data);
});

// POST /instillations
router.post('/', async (req, res) => {
    const pair: InstillationPair = {
        ...req.body,
        id: req.body.id || crypto.randomUUID(), // Node 19+ or polyfill, assuming sufficient node ver or uuid package. Use simple random string if not.
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
        return res.status(404).json({ error: 'Not found' });
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
        return res.status(404).json({ error: 'Not found' });
    }
    const deleted = data.pairs.splice(idx, 1);
    await writeData(data);
    res.json(deleted[0]);
});

// POST /resolve
// Check overrides
router.post('/resolve', async (req, res) => {
    const { input } = req.body;
    if (!input) return res.json({ response: null });

    const data = await readData();
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
                return res.json({ response: pair.response, matchedV: pair.id });
            }
        } else if (pair.match.type === 'regex') {
            try {
                const re = new RegExp(pair.trigger, pair.match.caseInsensitive ? 'i' : '');
                if (re.test(userInput)) {
                    return res.json({ response: pair.response, matchedV: pair.id });
                }
            } catch (e) {
                console.error('Regex error', e);
            }
        }
    }

    res.json({ response: null });
});

export default router;
