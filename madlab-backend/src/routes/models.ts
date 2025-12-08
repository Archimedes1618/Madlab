import { Router } from 'express';
import https from 'https';

const router = Router();

// Proxy to HuggingFace API to avoid CORS and hide logic
router.get('/search', async (req, res) => {
    const query = req.query.q as string || '';
    const limit = req.query.limit || 20;

    // Construct HF API URL
    // We filter by text-generation to keep it relevant
    const url = `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&filter=text-generation&sort=downloads&direction=-1&limit=${limit}&full=true`;

    const request = https.get(url, (response) => {
        let data = '';
        response.on('data', (chunk) => data += chunk);
        response.on('end', () => {
            try {
                const json = JSON.parse(data);
                res.json(json);
            } catch (e) {
                res.status(500).json({ error: 'Failed to parse HF response' });
            }
        });
    });

    request.on('error', (e) => {
        console.error(e);
        res.status(500).json({ error: 'Failed to connect to HuggingFace' });
    });
});

export const modelsRouter = router;
