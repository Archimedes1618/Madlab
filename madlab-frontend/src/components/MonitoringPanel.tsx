import { useRef, useEffect, memo } from 'react';
import type { LogLine, TrainingMetrics } from '../types';

interface MonitoringPanelProps {
    logs: LogLine[];
    metrics: TrainingMetrics;
    files: Record<string, number>;
}

// Memoized metric card component
const MetricCard = memo(function MetricCard({ value, label }: { value: string; label: string }) {
    return (
        <div className="metric-card">
            <div className="metric-val">{value}</div>
            <div className="metric-label">{label}</div>
        </div>
    );
});

// Memoized log entry component
const LogEntry = memo(function LogEntry({ log }: { log: LogLine }) {
    return (
        <div style={{ marginBottom: '4px', whiteSpace: 'pre-wrap' }}>
            <span style={{ color: '#64748b', marginRight: '8px' }}>[{log.timestamp}]</span>
            <span style={{ color: log.type === 'log' ? '#e2e8f0' : '#ec4899' }}>
                {typeof log.payload === 'string' ? log.payload : JSON.stringify(log.payload)}
            </span>
        </div>
    );
});

export const MonitoringPanel = memo(function MonitoringPanel({ logs, metrics, files }: MonitoringPanelProps) {
    const logsEndRef = useRef<HTMLDivElement>(null);

    // Single scroll effect (removed duplicate)
    useEffect(() => {
        if (logs.length > 0) {
            logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    return (
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h2>Real-time Monitoring</h2>

            {/* Metrics Cards */}
            <div className="card-grid">
                <MetricCard value={metrics.epoch?.toFixed(2) || '-'} label="Epoch" />
                <MetricCard value={metrics.loss?.toFixed(4) || '-'} label="Loss" />
                <MetricCard value={metrics.learning_rate?.toExponential(2) || '-'} label="Learning Rate" />
                <MetricCard value={metrics.grad_norm?.toFixed(2) || '-'} label="Grad Norm" />
            </div>

            {/* File Sizes */}
            <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                <h4 style={{ margin: '0 0 0.5rem 0' }}>File Sizes</h4>
                {Object.entries(files).map(([name, size]) => (
                    <div key={name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                        <span>{name}</span>
                        <span style={{ fontFamily: 'monospace' }}>{(Number(size) / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                ))}
                {Object.keys(files).length === 0 && <span style={{ color: '#64748b' }}>No file updates yet...</span>}
            </div>

            {/* Logs */}
            <div style={{ flex: 1, background: '#0f111a', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem', overflowY: 'auto', minHeight: '300px', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                {logs.map(log => (
                    <LogEntry key={log.id} log={log} />
                ))}
                <div ref={logsEndRef} />
            </div>

        </div>
    );
});
