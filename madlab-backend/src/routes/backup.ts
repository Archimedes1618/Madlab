import express from 'express';
import archiver from 'archiver';
import unzipper from 'unzipper';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config';
import { sanitizePath } from '../utils/security';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const BACKUP_VERSION = '1.0.0';
const BACKUP_PATHS = [
    { src: path.join(CONFIG.TRAINER_DIR, 'config'), dest: 'trainer/config', glob: '**/*.yaml' },
    { src: CONFIG.DATA_DIR, dest: 'data', glob: '**/*.jsonl' },
    { src: CONFIG.INSTILLATIONS_PATH, dest: 'data/instillations.json' },
    { src: CONFIG.HISTORY_PATH, dest: 'data/model_history.json' },
];

// POST /backup/export - create .madlab ZIP
router.post('/export', async (_req, res) => {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=madlab-backup-${Date.now()}.madlab`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);
    archive.on('error', (err) => res.status(500).json({ error: err.message }));

    // Add manifest
    archive.append(JSON.stringify({ version: BACKUP_VERSION, created: new Date().toISOString() }), { name: 'manifest.json' });

    for (const { src, dest, glob } of BACKUP_PATHS) {
        if (!fs.existsSync(src)) continue;
        if (fs.statSync(src).isDirectory()) {
            archive.glob(glob!, { cwd: src }, { prefix: dest });
        } else {
            archive.file(src, { name: dest });
        }
    }

    await archive.finalize();
});

// POST /backup/import - restore from ZIP
router.post('/import', upload.single('backup'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No backup file provided' });

    try {
        const entries: string[] = [];
        const directory = await unzipper.Open.buffer(req.file.buffer);

        // Validate manifest
        const manifestEntry = directory.files.find((f: { path: string }) => f.path === 'manifest.json');
        if (!manifestEntry) return res.status(400).json({ error: 'Invalid backup: missing manifest' });

        const manifest = JSON.parse((await manifestEntry.buffer()).toString());
        if (!manifest.version) return res.status(400).json({ error: 'Invalid manifest' });

        // Extract files
        for (const file of directory.files) {
            if (file.type === 'Directory' || file.path === 'manifest.json') continue;

            let destPath: string;
            try {
                if (file.path.startsWith('trainer/')) {
                    destPath = sanitizePath(CONFIG.TRAINER_DIR, file.path.replace('trainer/', ''));
                } else if (file.path.startsWith('data/')) {
                    destPath = sanitizePath(CONFIG.DATA_DIR, file.path.replace('data/', ''));
                } else continue;
            } catch {
                // Path traversal attempt - skip this file silently
                continue;
            }

            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            fs.writeFileSync(destPath, await file.buffer());
            entries.push(file.path);
        }

        res.json({ restored: entries.length, files: entries, version: manifest.version });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
