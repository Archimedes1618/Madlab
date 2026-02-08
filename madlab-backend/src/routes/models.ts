import { Router } from 'express';
import https from 'https';
import type { HFModel } from '../types';
import { getLineage } from '../services/lineage';

const router = Router();

// Proxy to HuggingFace API to avoid CORS and hide logic
router.get('/search', async (req, res) => {
    const query = (req.query.q as string) || '';
    const limitParam = req.query.limit;

    // Validate and parse limit
    let limit = 20;
    if (limitParam) {
        const parsed = parseInt(String(limitParam), 10);
        if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
            limit = parsed;
        }
    }

    // Construct HF API URL - filter by text-generation
    const url = `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&filter=text-generation&sort=downloads&direction=-1&limit=${limit}&full=true`;

    const request = https.get(url, { timeout: 30000 }, (response) => {
        let data = '';
        response.on('data', (chunk) => data += chunk);
        response.on('end', () => {
            try {
                const json = JSON.parse(data) as HFModel[];
                res.json(json);
            } catch {
                res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to parse HF response' } });
            }
        });
    });

    request.on('timeout', () => {
        request.destroy();
        res.status(504).json({ error: { code: 'TIMEOUT', message: 'HuggingFace request timed out' } });
    });

    request.on('error', (e) => {
        console.error('HuggingFace API error:', e);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to connect to HuggingFace' } });
    });
});

// GET /models/:name/lineage
router.get('/:name/lineage', async (req, res) => {
    const lineage = await getLineage(req.params.name);
    if (!lineage) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No lineage found' } });
    res.json(lineage);
});

// GET /models/compare?models=a,b
router.get('/compare', async (req, res) => {
    const names = (req.query.models as string || '').split(',').filter(Boolean);
    if (names.length < 2) return res.status(400).json({ error: { code: 'INVALID_PARAM', message: 'Need at least 2 models' } });
    const results = await Promise.all(names.map(async n => ({ model: n, lineage: await getLineage(n) })));
    res.json(results);
});

export const modelsRouter = router;
