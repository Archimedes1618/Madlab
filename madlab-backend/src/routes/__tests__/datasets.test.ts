import express from 'express';
import request from 'supertest';

// Mocks
const mockFsExistsSync = jest.fn();
const mockFsReaddirSync = jest.fn();
const mockFsStatSync = jest.fn();
const mockFsMkdirSync = jest.fn();
const mockFsReadFile = jest.fn();
const mockFsWriteFile = jest.fn();
const mockFsUnlink = jest.fn();
const mockFsCopyFile = jest.fn();
const mockLogEvent = jest.fn();
const mockSpawn = jest.fn();
const mockFetchWithTimeout = jest.fn();

jest.mock('fs', () => ({
    existsSync: (...args: any[]) => mockFsExistsSync(...args),
    readdirSync: (...args: any[]) => mockFsReaddirSync(...args),
    statSync: (...args: any[]) => mockFsStatSync(...args),
    mkdirSync: (...args: any[]) => mockFsMkdirSync(...args),
    readFileSync: () => 'data:\n  path: ../data/train.jsonl',
    promises: {
        readFile: (...args: any[]) => mockFsReadFile(...args),
        writeFile: (...args: any[]) => mockFsWriteFile(...args),
        unlink: (...args: any[]) => mockFsUnlink(...args),
        copyFile: (...args: any[]) => mockFsCopyFile(...args),
    },
}));

jest.mock('fs/promises', () => ({
    readFile: (...args: any[]) => mockFsReadFile(...args),
    writeFile: (...args: any[]) => mockFsWriteFile(...args),
    unlink: (...args: any[]) => mockFsUnlink(...args),
    copyFile: (...args: any[]) => mockFsCopyFile(...args),
}));

jest.mock('child_process', () => ({
    spawn: (...args: any[]) => mockSpawn(...args),
}));

jest.mock('../../utils/fetch', () => ({
    fetchWithTimeout: (...args: any[]) => mockFetchWithTimeout(...args),
}));

jest.mock('../../services/auditLogger', () => ({
    logEvent: (...args: any[]) => mockLogEvent(...args),
}));

jest.mock('../../config', () => ({
    CONFIG: {
        DATA_DIR: '/fake/data',
        TRAINER_DIR: '/fake/trainer',
        CONFIG_PATH: '/fake/trainer/config/train.yaml',
        LM_STUDIO_URL: 'http://localhost:1234',
        LLM_TIMEOUT: 30000,
    },
    getPythonPath: () => 'python3',
}));

jest.mock('../../utils/security', () => ({
    sanitizePath: (base: string, userPath: string) => {
        if (userPath.includes('..')) throw new Error('Path traversal attempt detected');
        return `${base}/${userPath}`;
    },
    validateHFRepo: (repo: string) => /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(repo),
    validateFilename: (name: string) =>
        !name.includes('/') && !name.includes('\\') && !name.includes('\0') && name.length > 0 && name.length < 256,
}));

jest.mock('../../utils/validation', () => ({
    MAX_FILE_SIZE_BYTES: 100 * 1024 * 1024,
}));

// Import router once (mocks are already in place)
import datasetsRouter from '../../routes/datasets';

describe('datasets routes', () => {
    let app: express.Application;

    beforeEach(() => {
        jest.clearAllMocks();

        // Default: directories exist
        mockFsExistsSync.mockReturnValue(true);
        mockFsReaddirSync.mockReturnValue([]);
        mockFsMkdirSync.mockReturnValue(undefined);

        app = express();
        app.use(express.json());
        app.use('/datasets', datasetsRouter);
    });

    describe('GET /datasets', () => {
        it('returns empty array when no datasets', async () => {
            mockFsReaddirSync.mockReturnValue([]);

            const res = await request(app).get('/datasets');

            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });

        it('returns datasets list with metadata', async () => {
            mockFsReaddirSync.mockReturnValue(['train.jsonl', 'test.jsonl']);
            mockFsStatSync.mockReturnValue({ size: 1024, birthtime: new Date('2024-01-01') });
            mockFsReadFile.mockResolvedValue('data:\n  path: ../data/train.jsonl');

            const res = await request(app).get('/datasets');

            expect(res.status).toBe(200);
            expect(res.body.length).toBe(2);
            expect(res.body[0].name).toBe('train.jsonl');
            expect(res.body[0].size).toBe(1024);
        });

        it('marks selected dataset based on config', async () => {
            mockFsReaddirSync.mockReturnValue(['train.jsonl', 'other.jsonl']);
            mockFsStatSync.mockReturnValue({ size: 1024, birthtime: new Date() });
            mockFsReadFile.mockResolvedValue('data:\n  path: ../data/train.jsonl');

            const res = await request(app).get('/datasets');

            expect(res.status).toBe(200);
            const selected = res.body.find((d: any) => d.selected);
            expect(selected?.name).toBe('train.jsonl');
        });
    });

    describe('GET /datasets/:name/preview', () => {
        it('returns preview of dataset', async () => {
            mockFsExistsSync.mockReturnValue(true);
            mockFsReadFile.mockResolvedValue(
                '{"input":"hello","target":"world"}\n{"input":"foo","target":"bar"}'
            );

            const res = await request(app).get('/datasets/train.jsonl/preview');

            expect(res.status).toBe(200);
            expect(res.body.samples.length).toBe(2);
            expect(res.body.stats.rowCount).toBe(2);
        });

        it('returns 404 when file not found', async () => {
            mockFsExistsSync.mockReturnValue(false);

            const res = await request(app).get('/datasets/nonexistent.jsonl/preview');

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });

        it('rejects invalid filename with special chars', async () => {
            // Filename with null byte should be rejected
            const res = await request(app).get('/datasets/test\x00file.jsonl/preview');

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_INPUT');
        });

        it('respects limit parameter', async () => {
            mockFsExistsSync.mockReturnValue(true);
            const lines = Array(10).fill('{"input":"a","target":"b"}').join('\n');
            mockFsReadFile.mockResolvedValue(lines);

            const res = await request(app).get('/datasets/train.jsonl/preview?limit=3');

            expect(res.status).toBe(200);
            expect(res.body.samples.length).toBe(3);
        });

        it('reports errors for invalid JSON lines', async () => {
            mockFsExistsSync.mockReturnValue(true);
            mockFsReadFile.mockResolvedValue(
                '{"input":"valid","target":"ok"}\ninvalid json\n{"input":"also valid","target":"ok"}'
            );

            const res = await request(app).get('/datasets/train.jsonl/preview');

            expect(res.status).toBe(200);
            expect(res.body.errors.some((e: string) => e.includes('invalid JSON'))).toBe(true);
        });

        it('reports errors for empty inputs/targets', async () => {
            mockFsExistsSync.mockReturnValue(true);
            mockFsReadFile.mockResolvedValue('{"input":"","target":"ok"}\n{"input":"ok","target":""}');

            const res = await request(app).get('/datasets/train.jsonl/preview');

            expect(res.status).toBe(200);
            expect(res.body.errors.length).toBeGreaterThan(0);
        });
    });

    describe('DELETE /datasets/:filename', () => {
        it('deletes a dataset', async () => {
            mockFsExistsSync.mockReturnValue(true);
            mockFsUnlink.mockResolvedValue(undefined);
            mockFsReadFile.mockResolvedValue('');
            mockFsWriteFile.mockResolvedValue(undefined);

            const res = await request(app).delete('/datasets/train.jsonl');

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('File deleted');
        });

        it('returns 404 when file not found', async () => {
            mockFsExistsSync.mockReturnValue(false);

            const res = await request(app).delete('/datasets/nonexistent.jsonl');

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });

        it('rejects filename that is too long', async () => {
            // Filename over 256 chars should be rejected
            const longName = 'a'.repeat(300) + '.jsonl';
            const res = await request(app).delete(`/datasets/${longName}`);

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_INPUT');
        });
    });

    describe('POST /datasets/select', () => {
        it('selects a dataset', async () => {
            mockFsExistsSync.mockReturnValue(true);
            mockFsReadFile.mockResolvedValue('model:\n  name: test\ndata:\n  path: old.jsonl');
            mockFsWriteFile.mockResolvedValue(undefined);

            const res = await request(app).post('/datasets/select').send({ filename: 'new.jsonl' });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Dataset selected');
            expect(res.body.path).toBe('../data/new.jsonl');
        });

        it('returns 400 when no filename', async () => {
            const res = await request(app).post('/datasets/select').send({});

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_INPUT');
        });

        it('returns 404 when file not found', async () => {
            mockFsExistsSync.mockReturnValue(false);

            const res = await request(app).post('/datasets/select').send({ filename: 'nonexistent.jsonl' });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });

        it('rejects invalid filename', async () => {
            const res = await request(app).post('/datasets/select').send({ filename: '../etc/passwd' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_INPUT');
        });
    });

    describe('POST /datasets/generate', () => {
        it('returns 400 when missing fields', async () => {
            const res = await request(app).post('/datasets/generate').send({});

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_INPUT');
        });

        it('returns 400 when seedInput missing', async () => {
            const res = await request(app).post('/datasets/generate').send({ seedOutput: 'output', count: 5 });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_INPUT');
        });
    });

    describe('POST /datasets/import', () => {
        it('returns 400 when no repo provided', async () => {
            const res = await request(app).post('/datasets/import').send({});

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_INPUT');
        });

        it('rejects invalid HF repo format', async () => {
            const res = await request(app).post('/datasets/import').send({ repo: 'invalid-repo' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_INPUT');
            expect(res.body.error.message).toContain('Invalid repository format');
        });

        it('rejects path traversal in repo', async () => {
            const res = await request(app).post('/datasets/import').send({ repo: '../etc/passwd' });

            expect(res.status).toBe(400);
        });
    });

    describe('POST /datasets/clean', () => {
        it('returns 400 when no filename', async () => {
            const res = await request(app).post('/datasets/clean').send({});

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_INPUT');
        });

        it('rejects invalid filename', async () => {
            const res = await request(app).post('/datasets/clean').send({ filename: '../secret' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_INPUT');
        });

        it('returns 404 when file not found', async () => {
            mockFsExistsSync.mockReturnValue(false);

            const res = await request(app).post('/datasets/clean').send({ filename: 'nonexistent.jsonl' });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });
    });

    describe('POST /datasets/smart_import', () => {
        it('returns 400 when no repo provided', async () => {
            const res = await request(app).post('/datasets/smart_import').send({});

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_INPUT');
        });

        it('rejects invalid repo format', async () => {
            const res = await request(app).post('/datasets/smart_import').send({ repo: 'noslash' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_INPUT');
        });
    });

    describe('GET /datasets/:name/versions', () => {
        it('returns empty array when no versions', async () => {
            mockFsExistsSync.mockReturnValue(false);

            const res = await request(app).get('/datasets/train.jsonl/versions');

            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });

        it('rejects name that is too long', async () => {
            const longName = 'a'.repeat(300);
            const res = await request(app).get(`/datasets/${longName}/versions`);

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_INPUT');
        });
    });

    describe('GET /datasets/:name/versions/:version', () => {
        it('rejects non-numeric version', async () => {
            const res = await request(app).get('/datasets/train.jsonl/versions/abc');

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_INPUT');
        });

        it('returns 404 when version not found', async () => {
            mockFsExistsSync.mockReturnValue(false);

            const res = await request(app).get('/datasets/train.jsonl/versions/12345');

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });
    });

    describe('POST /datasets/:name/rollback/:version', () => {
        it('rejects non-numeric version', async () => {
            const res = await request(app).post('/datasets/train.jsonl/rollback/invalid');

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_INPUT');
        });

        it('returns 404 when version file not found', async () => {
            mockFsExistsSync.mockReturnValue(false);

            const res = await request(app).post('/datasets/train.jsonl/rollback/12345');

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });

        it('performs rollback when version exists', async () => {
            mockFsExistsSync.mockReturnValue(true);
            mockFsReadFile.mockResolvedValue('content');
            mockFsWriteFile.mockResolvedValue(undefined);
            mockFsCopyFile.mockResolvedValue(undefined);

            const res = await request(app).post('/datasets/train.jsonl/rollback/12345');

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Rolled back');
            expect(res.body.version).toBe('12345');
        });
    });

    describe('POST /datasets/:name/analyze-quality', () => {
        it('rejects name that is too long', async () => {
            const longName = 'a'.repeat(300);
            const res = await request(app).post(`/datasets/${longName}/analyze-quality`);

            expect(res.status).toBe(400);
        });

        it('returns 404 when dataset not found', async () => {
            mockFsExistsSync.mockReturnValue(false);

            const res = await request(app).post('/datasets/nonexistent/analyze-quality');

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });
    });

    describe('POST /datasets/:name/augment', () => {
        it('rejects name that is too long', async () => {
            const longName = 'a'.repeat(300);
            const res = await request(app).post(`/datasets/${longName}/augment`);

            expect(res.status).toBe(400);
        });

        it('rejects invalid multiplier', async () => {
            mockFsExistsSync.mockReturnValue(true);

            const res = await request(app).post('/datasets/train/augment').send({ multiplier: 10 });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_INPUT');
        });

        it('returns 404 when dataset not found', async () => {
            mockFsExistsSync.mockReturnValue(false);

            const res = await request(app).post('/datasets/nonexistent/augment');

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });
    });
});
