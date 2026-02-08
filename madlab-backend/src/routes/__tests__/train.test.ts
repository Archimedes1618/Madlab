import express from 'express';
import request from 'supertest';

// Mocks
const mockStartTraining = jest.fn();
const mockStopTraining = jest.fn();
const mockGetStatus = jest.fn();
const mockGetQueue = jest.fn();
const mockEnqueueJob = jest.fn();
const mockRemoveJob = jest.fn();
const mockBuildDataset = jest.fn();
const mockConvertToGGUF = jest.fn();
const mockEvaluateGGUF = jest.fn();
const mockJudgeModel = jest.fn();
const mockLogEvent = jest.fn();
const mockFsExistsSync = jest.fn();
const mockFsReaddirSync = jest.fn();
const mockFsStatSync = jest.fn();
const mockFsReadFile = jest.fn();
const mockFsWriteFile = jest.fn();

jest.mock('../../services/processManager', () => ({
    startTraining: (...args: any[]) => mockStartTraining(...args),
    stopTraining: (...args: any[]) => mockStopTraining(...args),
    getStatus: () => mockGetStatus(),
    getQueue: () => mockGetQueue(),
    enqueueJob: (...args: any[]) => mockEnqueueJob(...args),
    removeJob: (...args: any[]) => mockRemoveJob(...args),
}));

jest.mock('../../services/datasetBuilder', () => ({
    buildDataset: () => mockBuildDataset(),
}));

jest.mock('../../services/modelConverter', () => ({
    convertToGGUF: (...args: any[]) => mockConvertToGGUF(...args),
    evaluateGGUF: (...args: any[]) => mockEvaluateGGUF(...args),
    judgeModel: (...args: any[]) => mockJudgeModel(...args),
}));

jest.mock('../../services/auditLogger', () => ({
    logEvent: (...args: any[]) => mockLogEvent(...args),
}));

jest.mock('fs', () => ({
    existsSync: (...args: any[]) => mockFsExistsSync(...args),
    readdirSync: (...args: any[]) => mockFsReaddirSync(...args),
    statSync: (...args: any[]) => mockFsStatSync(...args),
    readFileSync: () => 'model:\n  name: test',
    promises: {
        readFile: (...args: any[]) => mockFsReadFile(...args),
        writeFile: (...args: any[]) => mockFsWriteFile(...args),
    },
}));

jest.mock('fs/promises', () => ({
    readFile: (...args: any[]) => mockFsReadFile(...args),
    writeFile: (...args: any[]) => mockFsWriteFile(...args),
}));

jest.mock('../../config', () => ({
    CONFIG: {
        DATA_DIR: '/fake/data',
        MODELS_DIR: '/fake/models',
        TRAINER_DIR: '/fake/trainer',
        CONFIG_PATH: '/fake/trainer/config/train.yaml',
        HISTORY_PATH: '/fake/data/model_history.json',
        LM_STUDIO_URL: 'http://localhost:1234',
        LLM_TIMEOUT: 30000,
    },
    getPythonPath: () => 'python3',
}));

jest.mock('../../utils/validation', () => ({
    isValidQuantization: (v: string) => ['f16', 'q8_0', 'q5_0', 'q4_0'].includes(v),
    isValidSharpness: (v: number) => v >= 0 && v <= 100,
    isValidEvalLimit: (v: number) => v >= 0.01 && v <= 1.0,
    ALLOWED_QUANTIZATIONS: ['f16', 'q8_0', 'q5_0', 'q4_0'],
}));

jest.mock('../../utils/security', () => ({
    isPathSafe: (p: string, base: string) => !p.includes('..') && !p.startsWith('/'),
}));

// Import router once (mocks are already in place)
import trainRouter from '../../routes/train';

describe('train routes', () => {
    let app: express.Application;

    beforeEach(() => {
        jest.clearAllMocks();
        mockGetStatus.mockReturnValue({ running: false });
        mockGetQueue.mockReturnValue([]);

        app = express();
        app.use(express.json());
        app.use('/train', trainRouter);
    });

    describe('POST /train/start', () => {
        it('starts training successfully', async () => {
            mockBuildDataset.mockResolvedValue(100);
            mockStartTraining.mockResolvedValue(undefined);

            const res = await request(app).post('/train/start').send({});

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Training started');
            expect(res.body.datasetSize).toBe(100);
            expect(mockStartTraining).toHaveBeenCalledWith('config/train.yaml');
        });

        it('uses custom configPath when provided', async () => {
            mockBuildDataset.mockResolvedValue(50);
            mockStartTraining.mockResolvedValue(undefined);

            const res = await request(app).post('/train/start').send({ configPath: 'config/custom.yaml' });

            expect(res.status).toBe(200);
            expect(mockStartTraining).toHaveBeenCalledWith('config/custom.yaml');
        });

        it('rejects path traversal in configPath', async () => {
            const res = await request(app).post('/train/start').send({ configPath: '../../../etc/passwd' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_PATH');
        });

        it('returns 500 on training error', async () => {
            mockBuildDataset.mockResolvedValue(100);
            mockStartTraining.mockRejectedValue(new Error('Training already in progress'));

            const res = await request(app).post('/train/start').send({});

            expect(res.status).toBe(500);
            expect(res.body.error.message).toBe('Training already in progress');
        });
    });

    describe('POST /train/stop', () => {
        it('stops training', async () => {
            mockStopTraining.mockResolvedValue(undefined);

            const res = await request(app).post('/train/stop').send();

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Training stopped');
            expect(mockStopTraining).toHaveBeenCalled();
        });
    });

    describe('GET /train/status', () => {
        it('returns status when not running', async () => {
            mockGetStatus.mockReturnValue({ running: false });

            const res = await request(app).get('/train/status');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ running: false });
        });

        it('returns status with pid when running', async () => {
            mockGetStatus.mockReturnValue({ running: true, pid: 12345 });

            const res = await request(app).get('/train/status');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ running: true, pid: 12345 });
        });
    });

    describe('POST /train/enqueue', () => {
        it('enqueues a job', async () => {
            const job = { id: 'job-1', configPath: 'config/train.yaml', status: 'queued', createdAt: Date.now() };
            mockEnqueueJob.mockReturnValue(job);

            const res = await request(app).post('/train/enqueue').send({});

            expect(res.status).toBe(200);
            expect(res.body.id).toBe('job-1');
        });

        it('rejects path traversal in enqueue configPath', async () => {
            const res = await request(app).post('/train/enqueue').send({ configPath: '../../etc/passwd' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_PATH');
        });
    });

    describe('GET /train/queue', () => {
        it('returns queue', async () => {
            const queue = [{ id: 'job-1', configPath: 'config/train.yaml', status: 'queued' }];
            mockGetQueue.mockReturnValue(queue);

            const res = await request(app).get('/train/queue');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(queue);
        });
    });

    describe('DELETE /train/queue/:id', () => {
        it('removes job from queue', async () => {
            mockRemoveJob.mockReturnValue(true);

            const res = await request(app).delete('/train/queue/job-1');

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Job removed');
        });

        it('returns 404 when job not found', async () => {
            mockRemoveJob.mockReturnValue(false);

            const res = await request(app).delete('/train/queue/nonexistent');

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });
    });

    describe('POST /train/convert', () => {
        it('starts conversion with defaults', async () => {
            mockConvertToGGUF.mockResolvedValue(undefined);

            const res = await request(app).post('/train/convert').send({});

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Conversion complete');
            expect(mockConvertToGGUF).toHaveBeenCalledWith({ modelName: 'tuned', quantization: 'q8_0' });
        });

        it('rejects invalid quantization', async () => {
            const res = await request(app).post('/train/convert').send({ quantization: 'invalid' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_PARAM');
        });
    });

    describe('POST /train/evaluate', () => {
        it('starts evaluation', async () => {
            mockEvaluateGGUF.mockResolvedValue(undefined);

            const res = await request(app).post('/train/evaluate').send({ limit: 0.5 });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Evaluation complete');
        });

        it('rejects invalid limit', async () => {
            const res = await request(app).post('/train/evaluate').send({ limit: 5.0 });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_PARAM');
            expect(res.body.error.message).toContain('Limit must be');
        });
    });

    describe('POST /train/judge', () => {
        it('starts judge', async () => {
            mockJudgeModel.mockResolvedValue(undefined);

            const res = await request(app).post('/train/judge').send({});

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Magic Judge started');
        });

        it('rejects invalid sharpness', async () => {
            const res = await request(app).post('/train/judge').send({ sharpness: 150 });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_PARAM');
            expect(res.body.error.message).toContain('Sharpness');
        });
    });

    describe('GET /train/checkpoints', () => {
        it('returns empty array when no checkpoints dir', async () => {
            mockFsExistsSync.mockReturnValue(false);

            const res = await request(app).get('/train/checkpoints');

            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });

        it('returns checkpoints list', async () => {
            mockFsExistsSync.mockReturnValue(true);
            mockFsReaddirSync
                .mockReturnValueOnce([{ isDirectory: () => true, name: 'run1' }])
                .mockReturnValueOnce(['checkpoint-100.pt', 'checkpoint-200.pt']);
            mockFsStatSync.mockReturnValue({ mtime: new Date('2024-01-01') });

            const res = await request(app).get('/train/checkpoints');

            expect(res.status).toBe(200);
            expect(res.body.length).toBe(2);
        });
    });

    describe('GET /train/artifacts', () => {
        it('returns empty array when models dir missing', async () => {
            mockFsExistsSync.mockReturnValue(false);

            const res = await request(app).get('/train/artifacts');

            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });

        it('returns artifacts list', async () => {
            mockFsExistsSync.mockReturnValue(true);
            mockFsReaddirSync.mockReturnValue(['model.gguf', 'config.json', 'results.png', 'other.txt']);

            const res = await request(app).get('/train/artifacts');

            expect(res.status).toBe(200);
            expect(res.body.length).toBe(3); // Only .gguf, .json, .png
        });
    });

    describe('GET /train/config', () => {
        it('returns config when exists', async () => {
            // Need to specifically match the config path that the route checks
            mockFsExistsSync.mockImplementation((p: string) => {
                return p === '/fake/trainer/config/train.yaml';
            });
            mockFsReadFile.mockImplementation(async (filePath: string) => {
                if (filePath === '/fake/trainer/config/train.yaml') {
                    return 'model:\n  name: test\ndata:\n  path: data.jsonl';
                }
                throw new Error(`File not found: ${filePath}`);
            });

            const res = await request(app).get('/train/config');

            expect(res.status).toBe(200);
            expect(res.body.model.name).toBe('test');
        });

        it('returns 404 when config missing', async () => {
            mockFsExistsSync.mockReturnValue(false);

            const res = await request(app).get('/train/config');

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });
    });

    describe('POST /train/config', () => {
        it('saves config', async () => {
            // POST /train/config writes to the config path
            mockFsExistsSync.mockReturnValue(false);
            mockFsWriteFile.mockResolvedValue(undefined);
            mockFsReadFile.mockResolvedValue('[]'); // for updateModelHistory

            const config = { model: { name: 'new-model' }, data: { path: 'data.jsonl' } };
            const res = await request(app).post('/train/config').send(config);

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Config updated');
            expect(mockFsWriteFile).toHaveBeenCalled();
        });

        it('rejects negative max_samples', async () => {
            const config = { data: { max_samples: -5 } };
            const res = await request(app).post('/train/config').send(config);

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(res.body.error.message).toContain('max_samples');
        });

        it('rejects non-integer max_samples', async () => {
            const config = { data: { max_samples: 3.5 } };
            const res = await request(app).post('/train/config').send(config);

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('rejects zero epochs', async () => {
            const config = { train: { epochs: 0, batch_size: 4, lr: 0.001 } };
            const res = await request(app).post('/train/config').send(config);

            expect(res.status).toBe(400);
            expect(res.body.error.message).toContain('epochs');
        });

        it('rejects negative batch_size', async () => {
            const config = { train: { epochs: 3, batch_size: -1, lr: 0.001 } };
            const res = await request(app).post('/train/config').send(config);

            expect(res.status).toBe(400);
            expect(res.body.error.message).toContain('batch_size');
        });

        it('rejects zero lr', async () => {
            const config = { train: { epochs: 3, batch_size: 4, lr: 0 } };
            const res = await request(app).post('/train/config').send(config);

            expect(res.status).toBe(400);
            expect(res.body.error.message).toContain('lr');
        });

        it('rejects negative lr', async () => {
            const config = { train: { epochs: 3, batch_size: 4, lr: -0.001 } };
            const res = await request(app).post('/train/config').send(config);

            expect(res.status).toBe(400);
            expect(res.body.error.message).toContain('lr');
        });

        it('returns all validation errors at once', async () => {
            const config = { data: { max_samples: -1 }, train: { epochs: 0, batch_size: 0, lr: -1 } };
            const res = await request(app).post('/train/config').send(config);

            expect(res.status).toBe(400);
            expect(res.body.error.message).toContain('max_samples');
            expect(res.body.error.message).toContain('epochs');
            expect(res.body.error.message).toContain('batch_size');
            expect(res.body.error.message).toContain('lr');
        });
    });

    describe('GET /train/history', () => {
        it('returns empty array when no history file', async () => {
            mockFsExistsSync.mockImplementation((p: string) => {
                return p !== '/fake/data/model_history.json';
            });

            const res = await request(app).get('/train/history');

            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });

        it('returns history when file exists', async () => {
            mockFsExistsSync.mockImplementation((p: string) => {
                return p === '/fake/data/model_history.json';
            });
            mockFsReadFile.mockImplementation(async (filePath: string) => {
                if (filePath === '/fake/data/model_history.json') {
                    return '["model1", "model2"]';
                }
                throw new Error(`File not found: ${filePath}`);
            });

            const res = await request(app).get('/train/history');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(['model1', 'model2']);
        });
    });

    describe('POST /train/resume', () => {
        it('resumes training from checkpoint', async () => {
            mockFsExistsSync.mockReturnValue(true);
            mockStartTraining.mockResolvedValue(undefined);

            const res = await request(app).post('/train/resume').send({ runId: 'run1' });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Training resumed from checkpoint');
            expect(mockStartTraining).toHaveBeenCalledWith('config/train.yaml', true);
        });

        it('returns 404 when no checkpoint', async () => {
            mockFsExistsSync.mockReturnValue(false);

            const res = await request(app).post('/train/resume').send({ runId: 'nonexistent' });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });

        it('rejects path traversal in runId', async () => {
            const res = await request(app).post('/train/resume').send({ runId: '../../../etc/passwd' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_PATH');
        });
    });

    describe('POST /train/generate-test-cases', () => {
        it('returns 400 when no sample_inputs', async () => {
            const res = await request(app).post('/train/generate-test-cases').send({});

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_PARAM');
        });
    });

    describe('POST /train/analyze-failures', () => {
        it('returns 400 when no failures array', async () => {
            const res = await request(app).post('/train/analyze-failures').send({});

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_PARAM');
        });
    });
});
