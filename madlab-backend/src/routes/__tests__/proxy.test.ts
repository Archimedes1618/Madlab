import express from 'express';
import request from 'supertest';

// Mocks
const mockGetInstillations = jest.fn();
const mockIsLMStudioHealthy = jest.fn();
const mockGetLMStudioStatus = jest.fn();
const mockFetchWithTimeout = jest.fn();

jest.mock('../../services/instillationsCache', () => ({
    getInstillations: () => mockGetInstillations(),
}));

jest.mock('../../services/lmStudioHealth', () => ({
    isLMStudioHealthy: () => mockIsLMStudioHealthy(),
    getLMStudioStatus: () => mockGetLMStudioStatus(),
}));

jest.mock('../../utils/fetch', () => ({
    fetchWithTimeout: (...args: any[]) => mockFetchWithTimeout(...args),
}));

jest.mock('../../config', () => ({
    CONFIG: {
        LM_STUDIO_URL: 'http://localhost:1234',
        LLM_TIMEOUT: 30000,
    },
}));

describe('proxy routes', () => {
    let app: express.Application;

    beforeEach(async () => {
        jest.resetModules();
        jest.clearAllMocks();

        // Default: no instillations, healthy LM Studio
        mockGetInstillations.mockResolvedValue({ version: '1.0', pairs: [] });
        mockIsLMStudioHealthy.mockReturnValue(true);
        mockGetLMStudioStatus.mockReturnValue({ healthy: true, lastCheck: Date.now() });

        const proxyRouter = (await import('../../routes/proxy')).default;
        app = express();
        app.use(express.json());
        app.use('/api', proxyRouter);
    });

    describe('POST /api/chat/completions', () => {
        it('returns 400 when messages missing', async () => {
            const res = await request(app).post('/api/chat/completions').send({});

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_INPUT');
        });

        it('returns 400 when messages empty', async () => {
            const res = await request(app).post('/api/chat/completions').send({ messages: [] });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_INPUT');
        });

        it('returns 400 when messages not array', async () => {
            const res = await request(app).post('/api/chat/completions').send({ messages: 'not-array' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_INPUT');
        });

        it('matches exact instillation', async () => {
            mockGetInstillations.mockResolvedValue({
                version: '1.0',
                pairs: [{
                    id: '1',
                    trigger: 'hello',
                    match: { type: 'exact' },
                    response: 'world',
                    enabled: true,
                }],
            });

            const res = await request(app)
                .post('/api/chat/completions')
                .send({ messages: [{ role: 'user', content: 'hello' }] });

            expect(res.status).toBe(200);
            expect(res.body.choices[0].message.content).toBe('world');
            expect(res.body.model).toBe('madlab-instillation');
        });

        it('matches regex instillation', async () => {
            mockGetInstillations.mockResolvedValue({
                version: '1.0',
                pairs: [{
                    id: '1',
                    trigger: 'hello.*',
                    match: { type: 'regex' },
                    response: 'matched regex',
                    enabled: true,
                }],
            });

            const res = await request(app)
                .post('/api/chat/completions')
                .send({ messages: [{ role: 'user', content: 'hello world' }] });

            expect(res.status).toBe(200);
            expect(res.body.choices[0].message.content).toBe('matched regex');
        });

        it('applies case insensitive matching', async () => {
            mockGetInstillations.mockResolvedValue({
                version: '1.0',
                pairs: [{
                    id: '1',
                    trigger: 'HELLO',
                    match: { type: 'exact', caseInsensitive: true },
                    response: 'case insensitive match',
                    enabled: true,
                }],
            });

            const res = await request(app)
                .post('/api/chat/completions')
                .send({ messages: [{ role: 'user', content: 'hello' }] });

            expect(res.status).toBe(200);
            expect(res.body.choices[0].message.content).toBe('case insensitive match');
        });

        it('normalizes whitespace when configured', async () => {
            mockGetInstillations.mockResolvedValue({
                version: '1.0',
                pairs: [{
                    id: '1',
                    trigger: 'hello world',
                    match: { type: 'exact', normalizeWhitespace: true },
                    response: 'whitespace normalized',
                    enabled: true,
                }],
            });

            const res = await request(app)
                .post('/api/chat/completions')
                .send({ messages: [{ role: 'user', content: '  hello   world  ' }] });

            expect(res.status).toBe(200);
            expect(res.body.choices[0].message.content).toBe('whitespace normalized');
        });

        it('skips disabled instillations', async () => {
            mockGetInstillations.mockResolvedValue({
                version: '1.0',
                pairs: [{
                    id: '1',
                    trigger: 'hello',
                    match: { type: 'exact' },
                    response: 'disabled response',
                    enabled: false,
                }],
            });

            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({
                    id: 'cmpl-1',
                    choices: [{ message: { content: 'from LM Studio' } }],
                }),
            };
            mockFetchWithTimeout.mockResolvedValue(mockResponse);

            const res = await request(app)
                .post('/api/chat/completions')
                .send({ messages: [{ role: 'user', content: 'hello' }] });

            expect(res.status).toBe(200);
            expect(res.body.choices[0].message.content).toBe('from LM Studio');
            expect(mockFetchWithTimeout).toHaveBeenCalled();
        });

        it('returns 503 when LM Studio offline', async () => {
            mockIsLMStudioHealthy.mockReturnValue(false);

            const res = await request(app)
                .post('/api/chat/completions')
                .send({ messages: [{ role: 'user', content: 'test' }] });

            expect(res.status).toBe(503);
            expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
        });

        it('proxies to LM Studio when no instillation match', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({
                    id: 'cmpl-123',
                    choices: [{ index: 0, message: { role: 'assistant', content: 'LM Studio response' } }],
                    usage: { prompt_tokens: 10, completion_tokens: 5 },
                }),
            };
            mockFetchWithTimeout.mockResolvedValue(mockResponse);

            const res = await request(app)
                .post('/api/chat/completions')
                .send({ messages: [{ role: 'user', content: 'general question' }] });

            expect(res.status).toBe(200);
            expect(res.body.choices[0].message.content).toBe('LM Studio response');
            expect(mockFetchWithTimeout).toHaveBeenCalledWith(
                'http://localhost:1234/v1/chat/completions',
                expect.any(Object),
                30000
            );
        });

        it('returns upstream error status', async () => {
            const mockResponse = {
                ok: false,
                status: 429,
                text: () => Promise.resolve('Rate limited'),
            };
            mockFetchWithTimeout.mockResolvedValue(mockResponse);

            const res = await request(app)
                .post('/api/chat/completions')
                .send({ messages: [{ role: 'user', content: 'test' }] });

            expect(res.status).toBe(429);
        });

        it('caches non-streaming responses', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({
                    id: 'cmpl-cached',
                    choices: [{ message: { content: 'cached response' } }],
                }),
            };
            mockFetchWithTimeout.mockResolvedValue(mockResponse);

            // First request
            await request(app)
                .post('/api/chat/completions')
                .send({ messages: [{ role: 'user', content: 'cache me' }] });

            // Second identical request should use cache
            const res = await request(app)
                .post('/api/chat/completions')
                .send({ messages: [{ role: 'user', content: 'cache me' }] });

            expect(res.status).toBe(200);
            expect(res.body.choices[0].message.content).toBe('cached response');
            // Only one upstream call should be made
            expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);
        });

        it('handles fetch errors gracefully', async () => {
            mockFetchWithTimeout.mockRejectedValue(new Error('Network error'));

            const res = await request(app)
                .post('/api/chat/completions')
                .send({ messages: [{ role: 'user', content: 'test' }] });

            expect(res.status).toBe(500);
            expect(res.body.error.code).toBe('INTERNAL_ERROR');
            expect(res.body.error.message).toBe('Network error');
        });

        it('handles invalid regex gracefully', async () => {
            mockGetInstillations.mockResolvedValue({
                version: '1.0',
                pairs: [{
                    id: '1',
                    trigger: '[invalid(regex',
                    match: { type: 'regex' },
                    response: 'should not match',
                    enabled: true,
                }],
            });

            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({
                    id: 'cmpl-1',
                    choices: [{ message: { content: 'fallback' } }],
                }),
            };
            mockFetchWithTimeout.mockResolvedValue(mockResponse);

            const res = await request(app)
                .post('/api/chat/completions')
                .send({ messages: [{ role: 'user', content: 'test' }] });

            expect(res.status).toBe(200);
            // Should fall through to LM Studio since regex is invalid
            expect(mockFetchWithTimeout).toHaveBeenCalled();
        });
    });

    describe('GET /api/cache-stats', () => {
        it('returns cache statistics', async () => {
            const res = await request(app).get('/api/cache-stats');

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('hits');
            expect(res.body).toHaveProperty('misses');
            expect(res.body).toHaveProperty('size');
        });
    });

    describe('GET /api/health/lmstudio', () => {
        it('returns LM Studio health status', async () => {
            mockGetLMStudioStatus.mockReturnValue({
                healthy: true,
                lastCheck: 1704067200000,
                lastLatency: 50,
            });

            const res = await request(app).get('/api/health/lmstudio');

            expect(res.status).toBe(200);
            expect(res.body.healthy).toBe(true);
            expect(res.body).toHaveProperty('lastCheck');
        });

        it('returns unhealthy status', async () => {
            mockGetLMStudioStatus.mockReturnValue({
                healthy: false,
                lastCheck: 1704067200000,
                lastError: 'Connection refused',
            });

            const res = await request(app).get('/api/health/lmstudio');

            expect(res.status).toBe(200);
            expect(res.body.healthy).toBe(false);
            expect(res.body.lastError).toBe('Connection refused');
        });
    });
});
