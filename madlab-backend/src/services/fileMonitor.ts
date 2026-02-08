import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs/promises';
import { CONFIG } from '../config';
import type { WebSocketMessage } from '../types';

type BroadcastFn = (data: WebSocketMessage) => void;
let broadcastFn: BroadcastFn | null = null;

export async function startFileMonitor(broadcast: BroadcastFn): Promise<void> {
    broadcastFn = broadcast;
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
    if (!broadcastFn) return;
    try {
        const stats = await fs.stat(filePath);
        const name = path.basename(filePath);
        broadcastFn({
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
