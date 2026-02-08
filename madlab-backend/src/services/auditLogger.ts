import { promises as fs } from 'fs';
import path from 'path';
import { CONFIG } from '../config';

export interface AuditEvent {
    timestamp: string;
    operation: string;
    params: Record<string, unknown>;
    outcome: 'success' | 'failure';
    duration?: number;
    error?: string;
}

const AUDIT_PATH = path.join(CONFIG.DATA_DIR, 'audit.jsonl');

// Fire-and-forget append
export function logEvent(
    operation: string,
    params: Record<string, unknown>,
    outcome: 'success' | 'failure',
    duration?: number,
    error?: string
): void {
    const event: AuditEvent = {
        timestamp: new Date().toISOString(),
        operation,
        params,
        outcome,
        ...(duration !== undefined && { duration }),
        ...(error && { error }),
    };
    fs.appendFile(AUDIT_PATH, JSON.stringify(event) + '\n').catch(() => {});
}

// Query recent events
export async function queryEvents(limit = 100, since?: string): Promise<AuditEvent[]> {
    try {
        const data = await fs.readFile(AUDIT_PATH, 'utf8');
        const lines = data.trim().split('\n').filter(Boolean);
        let events = lines.map(l => JSON.parse(l) as AuditEvent);
        
        if (since) {
            events = events.filter(e => e.timestamp > since);
        }
        
        return events.slice(-limit);
    } catch {
        return [];
    }
}
