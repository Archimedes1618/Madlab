import { useRef, useEffect } from 'react';
import type { LogLine } from '../types';

interface MonitoringPanelProps {
    logs: LogLine[];
    metrics: any;
    files: Record<string, number>;
}

export function MonitoringPanel({ logs, metrics, files }: MonitoringPanelProps) {
    const logsEndRef = useRef<HTMLDivElement>(null);

    // Removed internal WebSocket logic
    // We scroll on log updates only if valid
    useEffect(() => {
        if (logs.length > 0) {
            logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    return (
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h2>Real-time Monitoring</h2>

            {/* Metrics Cards */}
            <div className="card-grid">
                <div className="metric-card">
                    <div className="metric-val">{metrics.epoch?.toFixed(2) || '-'}</div>
                    <div className="metric-label">Epoch</div>
                </div>
                <div className="metric-card">
                    <div className="metric-val">{metrics.loss?.toFixed(4) || '-'}</div>
                    <div className="metric-label">Loss</div>
                </div>
                <div className="metric-card">
                    <div className="metric-val">{metrics.learning_rate?.toExponential(2) || '-'}</div>
                    <div className="metric-label">Learning Rate</div>
                </div>
                <div className="metric-card">
                    <div className="metric-val">{metrics.grad_norm?.toFixed(2) || '-'}</div>
                    <div className="metric-label">Grad Norm</div>
                </div>
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
                    <div key={log.id} style={{ marginBottom: '4px', whiteSpace: 'pre-wrap' }}>
                        <span style={{ color: '#64748b', marginRight: '8px' }}>[{log.timestamp}]</span>
                        <span style={{ color: log.type === 'log' ? '#e2e8f0' : '#ec4899' }}>
                            {typeof log.payload === 'string' ? log.payload : JSON.stringify(log.payload)}
                        </span>
                    </div>
                ))}
                <div ref={logsEndRef} />
            </div>

        </div>
    );
}
