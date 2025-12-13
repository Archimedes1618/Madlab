import express from 'express';
import { fetchWithTimeout } from '../utils/fetch';
import { getInstillations } from '../services/instillationsCache';
import { CONFIG } from '../config';
import type { InstillationPair, LMStudioResponse } from '../types';

const router = express.Router();

router.post('/chat/completions', async (req, res) => {
    try {
        const { messages, stream } = req.body;
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid messages' } });
        }

        const lastMessage = messages[messages.length - 1];
        const input = lastMessage.content;

        // 1. Check Instillations (using cache)
        const data = await getInstillations();
        const activePairs = data.pairs.filter((p: InstillationPair) => p.enabled);

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
                } catch (regexErr) {
                    console.warn('Invalid regex pattern:', pair.trigger, regexErr);
                }
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
        console.log(`[Proxy] Forwarding to ${CONFIG.LM_STUDIO_URL}`);

        const upstreamRes = await fetchWithTimeout(`${CONFIG.LM_STUDIO_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        }, CONFIG.LLM_TIMEOUT);

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
                // @ts-ignore - node-fetch body type
                const reader = upstreamRes.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(value);
                }
                res.end();
            }
        } else {
            const json = await upstreamRes.json() as LMStudioResponse;
            res.json(json);
        }

    } catch (e: unknown) {
        console.error('[Proxy] Error:', e);
        const message = e instanceof Error ? e.message : 'Proxy error';
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
});

export default router;
