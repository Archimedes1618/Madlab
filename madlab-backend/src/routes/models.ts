import { Router } from 'express';
import https from 'https';
import type { HFModel } from '../types';

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

export const modelsRouter = router;
