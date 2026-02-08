import pino from 'pino';

export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development' 
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined
});

// Metrics state
const metrics = { requests: 0, errors: 0, latencies: [] as number[], startTime: Date.now() };

export function recordRequest(duration: number, isError: boolean) {
    metrics.requests++;
    if (isError) metrics.errors++;
    metrics.latencies.push(duration);
    if (metrics.latencies.length > 1000) metrics.latencies.shift();
}

export function getMetrics() {
    const sorted = [...metrics.latencies].sort((a, b) => a - b);
    const p = (n: number) => sorted[Math.floor(sorted.length * n)] || 0;
    return {
        request_count: metrics.requests,
        error_count: metrics.errors,
        latency_p50: p(0.5),
        latency_p99: p(0.99),
        uptime: (Date.now() - metrics.startTime) / 1000
    };
}
