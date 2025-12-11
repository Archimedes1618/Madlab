import fetch, { RequestInit, Response } from 'node-fetch';
import { AbortSignal } from 'node-fetch/externals';

/**
 * Fetch with timeout support
 */
export async function fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeoutMs: number = 30000
): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal as AbortSignal,
        });
        return response;
    } finally {
        clearTimeout(timeoutId);
    }
}
