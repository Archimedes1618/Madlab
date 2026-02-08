import express from 'express';
import request from 'supertest';
import { EventEmitter } from 'events';

// Mocks
const mockGetLineage = jest.fn();
const mockHttpsGet = jest.fn();

jest.mock('../../services/lineage', () => ({
    getLineage: (...args: any[]) => mockGetLineage(...args),
}));

jest.mock('https', () => ({
    get: (...args: any[]) => mockHttpsGet(...args),
}));

describe('models routes', () => {
    let app: express.Application;

    beforeEach(async () => {
        jest.resetModules();
        jest.clearAllMocks();

        const { modelsRouter } = await import('../../routes/models');
        app = express();
        app.use(express.json());
        app.use('/models', modelsRouter);
    });

    describe('GET /models/search', () => {
        function createMockResponse(data: any) {
            const response = new EventEmitter();
            setTimeout(() => {
                response.emit('data', JSON.stringify(data));
                response.emit('end');
            }, 0);
            return response;
        }

        it('searches HuggingFace with query', async () => {
            const mockModels = [
                { id: 'org/model1', likes: 100, downloads: 1000 },
                { id: 'org/model2', likes: 50, downloads: 500 },
            ];

            mockHttpsGet.mockImplementation((url, opts, callback) => {
                const response = createMockResponse(mockModels);
                callback(response);
                const req = new EventEmitter();
                (req as any).destroy = jest.fn();
                return req;
            });

            const res = await request(app).get('/models/search?q=llama');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockModels);
            expect(mockHttpsGet).toHaveBeenCalledWith(
                expect.stringContaining('search=llama'),
                expect.any(Object),
                expect.any(Function)
            );
        });

        it('uses default limit of 20', async () => {
            mockHttpsGet.mockImplementation((url, opts, callback) => {
                callback(createMockResponse([]));
                const req = new EventEmitter();
                (req as any).destroy = jest.fn();
                return req;
            });

            await request(app).get('/models/search?q=test');

            expect(mockHttpsGet).toHaveBeenCalledWith(
                expect.stringContaining('limit=20'),
                expect.any(Object),
                expect.any(Function)
            );
        });

        it('respects custom limit', async () => {
            mockHttpsGet.mockImplementation((url, opts, callback) => {
                callback(createMockResponse([]));
                const req = new EventEmitter();
                (req as any).destroy = jest.fn();
                return req;
            });

            await request(app).get('/models/search?q=test&limit=50');

            expect(mockHttpsGet).toHaveBeenCalledWith(
                expect.stringContaining('limit=50'),
                expect.any(Object),
                expect.any(Function)
            );
        });

        it('caps limit at 100', async () => {
            mockHttpsGet.mockImplementation((url, opts, callback) => {
                callback(createMockResponse([]));
                const req = new EventEmitter();
                (req as any).destroy = jest.fn();
                return req;
            });

            await request(app).get('/models/search?q=test&limit=200');

            // Should use default 20 when limit is invalid (>100)
            expect(mockHttpsGet).toHaveBeenCalledWith(
                expect.stringContaining('limit=20'),
                expect.any(Object),
                expect.any(Function)
            );
        });

        it('ignores invalid limit values', async () => {
            mockHttpsGet.mockImplementation((url, opts, callback) => {
                callback(createMockResponse([]));
                const req = new EventEmitter();
                (req as any).destroy = jest.fn();
                return req;
            });

            await request(app).get('/models/search?q=test&limit=invalid');

            expect(mockHttpsGet).toHaveBeenCalledWith(
                expect.stringContaining('limit=20'),
                expect.any(Object),
                expect.any(Function)
            );
        });

        it('handles empty query', async () => {
            mockHttpsGet.mockImplementation((url, opts, callback) => {
                callback(createMockResponse([]));
                const req = new EventEmitter();
                (req as any).destroy = jest.fn();
                return req;
            });

            const res = await request(app).get('/models/search');

            expect(res.status).toBe(200);
            expect(mockHttpsGet).toHaveBeenCalledWith(
                expect.stringContaining('search='),
                expect.any(Object),
                expect.any(Function)
            );
        });

        it('handles HF API timeout', async () => {
            mockHttpsGet.mockImplementation((url, opts, callback) => {
                const req = new EventEmitter();
                (req as any).destroy = jest.fn();
                setTimeout(() => req.emit('timeout'), 0);
                return req;
            });

            const res = await request(app).get('/models/search?q=test');

            expect(res.status).toBe(504);
            expect(res.body.error.code).toBe('TIMEOUT');
        });

        it('handles HF API errors', async () => {
            mockHttpsGet.mockImplementation((url, opts, callback) => {
                const req = new EventEmitter();
                (req as any).destroy = jest.fn();
                setTimeout(() => req.emit('error', new Error('Connection failed')), 0);
                return req;
            });

            const res = await request(app).get('/models/search?q=test');

            expect(res.status).toBe(500);
            expect(res.body.error.code).toBe('INTERNAL_ERROR');
        });

        it('handles invalid JSON response', async () => {
            mockHttpsGet.mockImplementation((url, opts, callback) => {
                const response = new EventEmitter();
                setTimeout(() => {
                    response.emit('data', 'not valid json');
                    response.emit('end');
                }, 0);
                callback(response);
                const req = new EventEmitter();
                (req as any).destroy = jest.fn();
                return req;
            });

            const res = await request(app).get('/models/search?q=test');

            expect(res.status).toBe(500);
            expect(res.body.error.code).toBe('INTERNAL_ERROR');
        });

        it('encodes query parameters properly', async () => {
            mockHttpsGet.mockImplementation((url, opts, callback) => {
                callback(createMockResponse([]));
                const req = new EventEmitter();
                (req as any).destroy = jest.fn();
                return req;
            });

            await request(app).get('/models/search?q=test model with spaces');

            expect(mockHttpsGet).toHaveBeenCalledWith(
                expect.stringContaining('search=test%20model%20with%20spaces'),
                expect.any(Object),
                expect.any(Function)
            );
        });
    });

    describe('GET /models/:name/lineage', () => {
        it('returns lineage when found', async () => {
            const lineage = {
                model: 'test-model',
                base: 'llama-7b',
                generations: ['llama-7b', 'llama-2-7b', 'test-model'],
            };
            mockGetLineage.mockResolvedValue(lineage);

            const res = await request(app).get('/models/test-model/lineage');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(lineage);
            expect(mockGetLineage).toHaveBeenCalledWith('test-model');
        });

        it('returns 404 when lineage not found', async () => {
            mockGetLineage.mockResolvedValue(null);

            const res = await request(app).get('/models/unknown-model/lineage');

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });

        it('handles model names with special characters', async () => {
            mockGetLineage.mockResolvedValue({ model: 'org/model-v2.1' });

            const res = await request(app).get('/models/org%2Fmodel-v2.1/lineage');

            expect(res.status).toBe(200);
            expect(mockGetLineage).toHaveBeenCalledWith('org/model-v2.1');
        });
    });

    describe('GET /models/compare', () => {
        it('returns 400 when less than 2 models provided', async () => {
            const res = await request(app).get('/models/compare?models=single');

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_PARAM');
            expect(res.body.error.message).toContain('at least 2');
        });

        it('returns 400 when no models provided', async () => {
            const res = await request(app).get('/models/compare');

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_PARAM');
        });

        it('returns 400 when models param is empty', async () => {
            const res = await request(app).get('/models/compare?models=');

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_PARAM');
        });

        it('compares multiple models', async () => {
            mockGetLineage
                .mockResolvedValueOnce({ model: 'model-a', base: 'llama' })
                .mockResolvedValueOnce({ model: 'model-b', base: 'mistral' });

            const res = await request(app).get('/models/compare?models=model-a,model-b');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(2);
            expect(res.body[0].model).toBe('model-a');
            expect(res.body[1].model).toBe('model-b');
            expect(mockGetLineage).toHaveBeenCalledTimes(2);
        });

        it('handles null lineage for some models', async () => {
            mockGetLineage
                .mockResolvedValueOnce({ model: 'model-a', base: 'llama' })
                .mockResolvedValueOnce(null);

            const res = await request(app).get('/models/compare?models=model-a,unknown');

            expect(res.status).toBe(200);
            expect(res.body[0].lineage).toBeTruthy();
            expect(res.body[1].lineage).toBeNull();
        });

        it('compares more than 2 models', async () => {
            mockGetLineage
                .mockResolvedValueOnce({ model: 'a' })
                .mockResolvedValueOnce({ model: 'b' })
                .mockResolvedValueOnce({ model: 'c' });

            const res = await request(app).get('/models/compare?models=a,b,c');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(3);
            expect(mockGetLineage).toHaveBeenCalledTimes(3);
        });

        it('filters empty model names from comparison', async () => {
            mockGetLineage
                .mockResolvedValueOnce({ model: 'a' })
                .mockResolvedValueOnce({ model: 'b' });

            const res = await request(app).get('/models/compare?models=a,,b,');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(2);
        });
    });
});
