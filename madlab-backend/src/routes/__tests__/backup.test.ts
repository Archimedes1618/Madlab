import express from 'express';
import request from 'supertest';

// Mocks
const mockFsExistsSync = jest.fn();
const mockFsStatSync = jest.fn();
const mockFsMkdirSync = jest.fn();
const mockFsWriteFileSync = jest.fn();
const mockUnzipperOpen = {
    buffer: jest.fn(),
};

// Create mock archive that properly ends the response stream
let capturedRes: any = null;
const mockArchive: Record<string, jest.Mock> = {
    pipe: jest.fn(),
    on: jest.fn(),
    append: jest.fn(),
    glob: jest.fn(),
    file: jest.fn(),
    finalize: jest.fn(),
};

// Set up chaining and finalize behavior
mockArchive.pipe.mockImplementation((res: any) => {
    capturedRes = res;
    return mockArchive;
});
mockArchive.on.mockReturnValue(mockArchive);
mockArchive.append.mockReturnValue(mockArchive);
mockArchive.glob.mockReturnValue(mockArchive);
mockArchive.file.mockReturnValue(mockArchive);
mockArchive.finalize.mockImplementation(async () => {
    if (capturedRes && typeof capturedRes.end === 'function') {
        capturedRes.end();
    }
});

jest.mock('fs', () => ({
    existsSync: (...args: any[]) => mockFsExistsSync(...args),
    statSync: (...args: any[]) => mockFsStatSync(...args),
    mkdirSync: (...args: any[]) => mockFsMkdirSync(...args),
    writeFileSync: (...args: any[]) => mockFsWriteFileSync(...args),
    promises: {
        readFile: jest.fn(),
        writeFile: jest.fn(),
    },
}));

jest.mock('archiver', () => {
    return () => mockArchive;
});

jest.mock('unzipper', () => ({
    Open: {
        buffer: (...args: any[]) => mockUnzipperOpen.buffer(...args),
    },
}));

jest.mock('../../config', () => ({
    CONFIG: {
        DATA_DIR: '/fake/data',
        TRAINER_DIR: '/fake/trainer',
        INSTILLATIONS_PATH: '/fake/data/instillations.json',
        HISTORY_PATH: '/fake/data/model_history.json',
    },
}));

jest.mock('../../utils/security', () => ({
    sanitizePath: (base: string, userPath: string) => {
        if (userPath.includes('..')) throw new Error('Path traversal attempt detected');
        return `${base}/${userPath}`;
    },
}));

// Import router once (mocks are already in place)
import backupRouter from '../../routes/backup';

describe('backup routes', () => {
    let app: express.Application;

    beforeEach(() => {
        jest.clearAllMocks();
        capturedRes = null;
        mockFsExistsSync.mockReturnValue(true);
        mockFsStatSync.mockReturnValue({ isDirectory: () => true });

        app = express();
        app.use(express.json());
        app.use('/backup', backupRouter);
    });

    describe('POST /backup/export', () => {
        it('creates backup zip with correct headers', async () => {
            mockFsExistsSync.mockReturnValue(true);
            mockFsStatSync.mockReturnValue({ isDirectory: () => true });

            const res = await request(app).post('/backup/export');

            expect(res.headers['content-type']).toBe('application/zip');
            expect(res.headers['content-disposition']).toMatch(/attachment.*\.madlab/);
        });

        it('adds manifest to archive', async () => {
            mockFsExistsSync.mockReturnValue(true);
            mockFsStatSync.mockReturnValue({ isDirectory: () => true });

            await request(app).post('/backup/export');

            expect(mockArchive.append).toHaveBeenCalledWith(
                expect.stringContaining('version'),
                { name: 'manifest.json' }
            );
        });

        it('skips missing paths', async () => {
            mockFsExistsSync.mockReturnValue(false);

            await request(app).post('/backup/export');

            // Should not call glob or file when paths don't exist
            expect(mockArchive.glob).not.toHaveBeenCalled();
            expect(mockArchive.file).not.toHaveBeenCalled();
        });

        it('adds directories with glob pattern', async () => {
            mockFsExistsSync.mockReturnValue(true);
            mockFsStatSync.mockReturnValue({ isDirectory: () => true });

            await request(app).post('/backup/export');

            expect(mockArchive.glob).toHaveBeenCalled();
        });

        it('adds files directly', async () => {
            mockFsExistsSync.mockImplementation((p: string) => p.endsWith('.json'));
            mockFsStatSync.mockReturnValue({ isDirectory: () => false });

            await request(app).post('/backup/export');

            expect(mockArchive.file).toHaveBeenCalled();
        });
    });

    describe('POST /backup/import', () => {
        it('returns 400 when no file uploaded', async () => {
            const res = await request(app).post('/backup/import');

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('No backup file provided');
        });

        it('returns 400 when manifest missing', async () => {
            mockUnzipperOpen.buffer.mockResolvedValue({
                files: [{ path: 'data/file.jsonl', type: 'File', buffer: () => Buffer.from('') }],
            });

            const res = await request(app)
                .post('/backup/import')
                .attach('backup', Buffer.from('fake-zip'), 'backup.madlab');

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Invalid backup: missing manifest');
        });

        it('returns 400 when manifest invalid', async () => {
            mockUnzipperOpen.buffer.mockResolvedValue({
                files: [
                    { path: 'manifest.json', type: 'File', buffer: () => Promise.resolve(Buffer.from('{}')) },
                ],
            });

            const res = await request(app)
                .post('/backup/import')
                .attach('backup', Buffer.from('fake-zip'), 'backup.madlab');

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Invalid manifest');
        });

        it('restores files from valid backup', async () => {
            const manifest = JSON.stringify({ version: '1.0.0', created: new Date().toISOString() });
            mockUnzipperOpen.buffer.mockResolvedValue({
                files: [
                    { path: 'manifest.json', type: 'File', buffer: () => Promise.resolve(Buffer.from(manifest)) },
                    { path: 'data/train.jsonl', type: 'File', buffer: () => Promise.resolve(Buffer.from('data')) },
                    { path: 'trainer/config/train.yaml', type: 'File', buffer: () => Promise.resolve(Buffer.from('yaml')) },
                ],
            });

            const res = await request(app)
                .post('/backup/import')
                .attach('backup', Buffer.from('fake-zip'), 'backup.madlab');

            expect(res.status).toBe(200);
            expect(res.body.restored).toBe(2);
            expect(res.body.files).toContain('data/train.jsonl');
            expect(res.body.files).toContain('trainer/config/train.yaml');
            expect(res.body.version).toBe('1.0.0');
        });

        it('skips directory entries', async () => {
            const manifest = JSON.stringify({ version: '1.0.0' });
            mockUnzipperOpen.buffer.mockResolvedValue({
                files: [
                    { path: 'manifest.json', type: 'File', buffer: () => Promise.resolve(Buffer.from(manifest)) },
                    { path: 'data/', type: 'Directory' },
                    { path: 'data/file.jsonl', type: 'File', buffer: () => Promise.resolve(Buffer.from('')) },
                ],
            });

            const res = await request(app)
                .post('/backup/import')
                .attach('backup', Buffer.from('fake-zip'), 'backup.madlab');

            expect(res.status).toBe(200);
            expect(res.body.restored).toBe(1);
            expect(res.body.files).not.toContain('data/');
        });

        it('skips files with path traversal', async () => {
            const manifest = JSON.stringify({ version: '1.0.0' });
            mockUnzipperOpen.buffer.mockResolvedValue({
                files: [
                    { path: 'manifest.json', type: 'File', buffer: () => Promise.resolve(Buffer.from(manifest)) },
                    { path: 'data/../../../etc/passwd', type: 'File', buffer: () => Promise.resolve(Buffer.from('pwned')) },
                    { path: 'data/safe.jsonl', type: 'File', buffer: () => Promise.resolve(Buffer.from('ok')) },
                ],
            });

            const res = await request(app)
                .post('/backup/import')
                .attach('backup', Buffer.from('fake-zip'), 'backup.madlab');

            expect(res.status).toBe(200);
            expect(res.body.restored).toBe(1);
            expect(res.body.files).not.toContain('data/../../../etc/passwd');
            expect(res.body.files).toContain('data/safe.jsonl');
        });

        it('skips files outside known prefixes', async () => {
            const manifest = JSON.stringify({ version: '1.0.0' });
            mockUnzipperOpen.buffer.mockResolvedValue({
                files: [
                    { path: 'manifest.json', type: 'File', buffer: () => Promise.resolve(Buffer.from(manifest)) },
                    { path: 'unknown/file.txt', type: 'File', buffer: () => Promise.resolve(Buffer.from('')) },
                ],
            });

            const res = await request(app)
                .post('/backup/import')
                .attach('backup', Buffer.from('fake-zip'), 'backup.madlab');

            expect(res.status).toBe(200);
            expect(res.body.restored).toBe(0);
        });

        it('creates directories as needed', async () => {
            const manifest = JSON.stringify({ version: '1.0.0' });
            mockUnzipperOpen.buffer.mockResolvedValue({
                files: [
                    { path: 'manifest.json', type: 'File', buffer: () => Promise.resolve(Buffer.from(manifest)) },
                    { path: 'data/nested/deep/file.jsonl', type: 'File', buffer: () => Promise.resolve(Buffer.from('')) },
                ],
            });

            await request(app)
                .post('/backup/import')
                .attach('backup', Buffer.from('fake-zip'), 'backup.madlab');

            expect(mockFsMkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
        });

        it('handles unzipper errors', async () => {
            mockUnzipperOpen.buffer.mockRejectedValue(new Error('Corrupt ZIP'));

            const res = await request(app)
                .post('/backup/import')
                .attach('backup', Buffer.from('corrupt'), 'backup.madlab');

            expect(res.status).toBe(500);
            expect(res.body.error).toBe('Corrupt ZIP');
        });
    });
});
