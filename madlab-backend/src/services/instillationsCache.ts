import fs from 'fs/promises';
import { CONFIG } from '../config';
import type { InstillationsData } from '../types';

let cache: InstillationsData | null = null;
let lastModified = 0;

/**
 * Get instillations data with caching based on file mtime.
 * Avoids reading file on every request.
 */
export async function getInstillations(): Promise<InstillationsData> {
    try {
        const stat = await fs.stat(CONFIG.INSTILLATIONS_PATH);
        const mtime = stat.mtimeMs;

        if (!cache || mtime > lastModified) {
            const data = await fs.readFile(CONFIG.INSTILLATIONS_PATH, 'utf-8');
            cache = JSON.parse(data);
            lastModified = mtime;
        }

        return cache!;
    } catch {
        return { version: '1.0', pairs: [] };
    }
}

/**
 * Invalidate the cache (call after writes)
 */
export function invalidateCache(): void {
    cache = null;
    lastModified = 0;
}
