import chokidar from 'chokidar';
import path from 'path';
import { broadcast } from '../server';
import fs from 'fs/promises';
import { CONFIG } from '../config';

export async function startFileMonitor(): Promise<void> {
    console.log(`Starting file monitor on ${CONFIG.MODELS_DIR}`);

    // Ensure models dir exists before starting watcher
    await fs.mkdir(CONFIG.MODELS_DIR, { recursive: true });

    const watcher = chokidar.watch(CONFIG.MODELS_DIR, {
        persistent: true,
        ignoreInitial: true
    });

    watcher.on('add', async (filePath) => {
        try {
            await emitSize(filePath);
        } catch (e) {
            console.error('Error emitting file size on add:', e);
        }
    });

    watcher.on('change', async (filePath) => {
        try {
            await emitSize(filePath);
        } catch (e) {
            console.error('Error emitting file size on change:', e);
        }
    });
}

async function emitSize(filePath: string): Promise<void> {
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
        // File might have been deleted, ignore
        console.warn('File stat failed:', e);
    }
}
