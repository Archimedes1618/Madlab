import express from 'express';
import fetch from 'node-fetch'; // Requires node-fetch@2 for CommonJS or dynamic import. Using built-in fetch if Node 18+
import fs from 'fs/promises';
import path from 'path';

// Helper to read data (duplicated from instillations.ts, ideally should be a shared service)
const DATA_FILE = path.join(__dirname, '../data/instillations.json');
async function readInstillations() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return { pairs: [] };
    }
}

const router = express.Router();
const UPSTREAM_URL = process.env.LM_STUDIO_URL || 'http://localhost:1234';

router.post('/chat/completions', async (req, res) => {
    try {
        const { messages, stream } = req.body;
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: 'Invalid messages' });
        }

        const lastMessage = messages[messages.length - 1];
        const input = lastMessage.content;

        // 1. Check Instillations
        const data = await readInstillations();
        const activePairs = data.pairs.filter((p: any) => p.enabled);

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

            let matched = false;
            if (pair.match.type === 'exact') {
                if (userInput === trigger) matched = true;
            } else if (pair.match.type === 'regex') {
                try {
                    const re = new RegExp(pair.trigger, pair.match.caseInsensitive ? 'i' : '');
                    if (re.test(userInput)) matched = true;
                } catch { }
            }

            if (matched) {
                console.log(`[Proxy] Instillation Matched: ${pair.trigger}`);
                // Return OpenAI-compatible response
                return res.json({
                    id: 'chatcmpl-madlab-' + Date.now(),
                    object: 'chat.completion',
                    created: Math.floor(Date.now() / 1000),
                    model: 'madlab-instillation',
                    choices: [{
                        index: 0,
                        message: { role: 'assistant', content: pair.response },
                        finish_reason: 'stop'
                    }],
                    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
                });
            }
        }

        // 2. Proxy to LM Studio
        console.log(`[Proxy] Forwarding to ${UPSTREAM_URL}`);

        // Note: fetch in Node 18+ is global.
        const upstreamRes = await fetch(`${UPSTREAM_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });

        if (!upstreamRes.ok) {
            const err = await upstreamRes.text();
            return res.status(upstreamRes.status).send(err);
        }

        // Handle streaming
        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            if (upstreamRes.body) {
                // node-fetch v3 or built-in web streams
                // If using built-in fetch (Node 18), body is a ReadableStream.
                // We need to pipe it to res (Writable).
                // @ts-ignore
                const reader = upstreamRes.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(value);
                }
                res.end();
            }
        } else {
            const json = await upstreamRes.json();
            res.json(json);
        }

    } catch (e: any) {
        console.error('[Proxy] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

export default router;
