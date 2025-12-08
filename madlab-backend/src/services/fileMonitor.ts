import chokidar from 'chokidar';
import path from 'path';
import { broadcast } from '../server';
import fs from 'fs/promises';

const MODELS_DIR = path.join(__dirname, '../models');

export function startFileMonitor() {
    console.log(`Starting file monitor on ${MODELS_DIR}`);

    // Ensure models dir exists
    fs.mkdir(MODELS_DIR, { recursive: true }).catch(console.error);

    const watcher = chokidar.watch(MODELS_DIR, {
        persistent: true,
        ignoreInitial: true
    });

    watcher.on('add', async (filePath) => {
        emitSize(filePath);
    });

    watcher.on('change', async (filePath) => {
        emitSize(filePath);
    });
}

async function emitSize(filePath: string) {
    try {
        const stats = await fs.stat(filePath);
        const name = path.basename(filePath);
        broadcast({
            type: 'file-size',
            payload: {
                file: name,
                size: stats.size,
                timestamp: Date.now()
            }
        });
    } catch (e) {
        // ignore
    }
}
