import { fetchWithTimeout } from '../utils/fetch';
import { CONFIG } from '../config';
import type { WebSocketMessage } from '../types';

let healthy = false;
let lastCheck = 0;
let broadcastFn: ((msg: WebSocketMessage) => void) | null = null;

async function checkHealth(): Promise<boolean> {
    try {
        const res = await fetchWithTimeout(`${CONFIG.LM_STUDIO_URL}/v1/models`, {}, 5000);
        return res.ok;
    } catch {
        return false;
    }
}

async function probe() {
    const was = healthy;
    healthy = await checkHealth();
    lastCheck = Date.now();
    if (was !== healthy && broadcastFn) {
        broadcastFn({
            type: 'status',
            payload: { message: `LM Studio ${healthy ? 'online' : 'offline'}` }
        });
    }
}

export function startHealthProbe(broadcast: (msg: WebSocketMessage) => void) {
    broadcastFn = broadcast;
    probe(); // immediate check
    setInterval(probe, 30000);
}

export function isLMStudioHealthy(): boolean {
    return healthy;
}

export function getLMStudioStatus() {
    return { status: healthy ? 'healthy' : 'unhealthy', lastCheck };
}
