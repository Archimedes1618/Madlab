import { useRef, useEffect, useState, memo } from 'react';
import type { LogLine, TrainingMetrics } from '../types';

interface SystemHealth {
    cpu: number;
    memory: { used: number; total: number; percent: number };
    gpu?: { name: string; memUsed: number; memTotal: number; utilization: number };
}

interface MonitoringPanelProps {
    logs: LogLine[];
    metrics: TrainingMetrics;
    lossHistory?: { step: number; loss: number }[];
}

const ProgressBar = memo(function ProgressBar({ label, percent, detail }: { label: string; percent: number; detail?: string }) {
    const colorConfig = percent > 90
        ? { color: '#ef4444', glow: 'rgba(239, 68, 68, 0.4)' }
        : percent > 70
            ? { color: '#f59e0b', glow: 'rgba(245, 158, 11, 0.3)' }
            : { color: '#22c55e', glow: 'rgba(34, 197, 94, 0.3)' };

    return (
        <div style={{ marginBottom: 10 }}>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.75rem',
                marginBottom: 6
            }}>
                <span style={{
                    fontWeight: 500,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase' as const,
                    letterSpacing: '0.04em'
                }}>{label}</span>
                <span style={{
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-muted)',
                    fontSize: '0.6875rem'
                }}>{detail || `${percent.toFixed(0)}%`}</span>
            </div>
            <div style={{
                background: 'rgba(0,0,0,0.3)',
                borderRadius: 4,
                height: 6,
                overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.04)'
            }}>
                <div style={{
                    width: `${Math.min(percent, 100)}%`,
                    background: `linear-gradient(90deg, ${colorConfig.color}, ${colorConfig.color}dd)`,
                    borderRadius: 3,
                    height: '100%',
                    transition: 'width 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                    boxShadow: percent > 70 ? `0 0 8px ${colorConfig.glow}` : 'none'
                }} />
            </div>
        </div>
    );
});

const formatBytes = (bytes: number) => (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';

// Memoized metric card component
const MetricCard = memo(function MetricCard({ value, label }: { value: string; label: string }) {
    return (
        <div className="metric-card">
            <div className="metric-val">{value}</div>
            <div className="metric-label">{label}</div>
        </div>
    );
});

// Format a number smartly based on its magnitude
const formatNum = (n: number, decimals = 4): string => {
    if (n === undefined || n === null || isNaN(n)) return '-';
    if (Math.abs(n) < 0.0001 || Math.abs(n) >= 10000) return n.toExponential(2);
    if (Number.isInteger(n)) return n.toString();
    return n.toFixed(decimals);
};

// Badge component for log type indicators
const Badge = memo(function Badge({ type, children }: { type: 'metric' | 'checkpoint' | 'info' | 'error' | 'validation' | 'warn'; children: React.ReactNode }) {
    const colors: Record<string, { bg: string; text: string; border: string }> = {
        metric: { bg: 'rgba(56, 189, 248, 0.1)', text: '#38bdf8', border: 'rgba(56, 189, 248, 0.3)' },
        checkpoint: { bg: 'rgba(34, 197, 94, 0.1)', text: '#22c55e', border: 'rgba(34, 197, 94, 0.3)' },
        validation: { bg: 'rgba(168, 85, 247, 0.1)', text: '#a855f7', border: 'rgba(168, 85, 247, 0.3)' },
        info: { bg: 'rgba(148, 163, 184, 0.1)', text: '#94a3b8', border: 'rgba(148, 163, 184, 0.3)' },
        error: { bg: 'rgba(239, 68, 68, 0.1)', text: '#ef4444', border: 'rgba(239, 68, 68, 0.3)' },
        warn: { bg: 'rgba(245, 158, 11, 0.1)', text: '#f59e0b', border: 'rgba(245, 158, 11, 0.3)' },
    };
    const c = colors[type] || colors.info;
    return (
        <span style={{
            background: c.bg, color: c.text, border: `1px solid ${c.border}`,
            padding: '2px 8px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.5px', marginRight: 8
        }}>{children}</span>
    );
});

// Expandable text for long content (tracebacks)
const ExpandableText = memo(function ExpandableText({ text, maxLines = 8, color }: { text: string; maxLines?: number; color: string }) {
    const [expanded, setExpanded] = useState(false);
    const lineCount = text.split('\n').length;
    const needsExpand = lineCount > maxLines;

    if (!needsExpand) {
        return <span style={{ color, fontSize: '0.8rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1 }}>{text}</span>;
    }

    return (
        <div style={{ flex: 1 }}>
            <div style={{
                color, fontSize: '0.8rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                maxHeight: expanded ? 'none' : `${maxLines * 1.4}em`, overflow: 'hidden'
            }}>{text}</div>
            <button
                onClick={() => setExpanded(!expanded)}
                style={{
                    background: 'rgba(255,255,255,0.1)', border: 'none', color: '#94a3b8',
                    fontSize: '0.7rem', padding: '2px 8px', borderRadius: 4, marginTop: 4, cursor: 'pointer'
                }}
            >{expanded ? '▲ Collapse' : `▼ Show all ${lineCount} lines`}</button>
        </div>
    );
});

// Metric pill for inline display
const MetricPill = memo(function MetricPill({ label, value, unit }: { label: string; value: string; unit?: string }) {
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: 'rgba(255,255,255,0.05)', padding: '3px 10px', borderRadius: 12,
            marginRight: 8, marginBottom: 4, fontSize: '0.8rem'
        }}>
            <span style={{ color: '#64748b' }}>{label}</span>
            <span style={{ color: '#e2e8f0', fontWeight: 600, fontFamily: 'monospace' }}>{value}</span>
            {unit && <span style={{ color: '#475569', fontSize: '0.7rem' }}>{unit}</span>}
        </span>
    );
});

// Memoized log entry component with smart formatting
const LogEntry = memo(function LogEntry({ log }: { log: LogLine }) {
    const payload = log.payload;

    // Parse payload if it's a string that looks like JSON
    let parsed: Record<string, unknown> | null = null;
    if (typeof payload === 'string') {
        try { parsed = JSON.parse(payload); } catch { parsed = null; }
    } else if (typeof payload === 'object' && payload !== null) {
        parsed = payload as Record<string, unknown>;
    }

    // Determine log type and render appropriately
    if (parsed) {
        // Training metrics (has loss, step, epoch, etc.)
        if ('loss' in parsed && 'step' in parsed) {
            return (
                <div style={{ marginBottom: 8, padding: '8px 12px', background: 'rgba(56, 189, 248, 0.03)', borderRadius: 6, borderLeft: '3px solid #38bdf8' }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                        <Badge type="metric">Train</Badge>
                        <span style={{ color: '#475569', fontSize: '0.75rem' }}>{log.timestamp}</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                        <MetricPill label="Step" value={String(parsed.step)} />
                        <MetricPill label="Loss" value={formatNum(parsed.loss as number)} />
                        {parsed.epoch !== undefined && <MetricPill label="Epoch" value={formatNum(parsed.epoch as number, 2)} />}
                        {parsed.learning_rate !== undefined && <MetricPill label="LR" value={formatNum(parsed.learning_rate as number)} />}
                        {parsed.grad_norm !== undefined && <MetricPill label="Grad" value={formatNum(parsed.grad_norm as number, 2)} />}
                    </div>
                </div>
            );
        }

        // Validation metrics
        if ('val_loss' in parsed) {
            return (
                <div style={{ marginBottom: 8, padding: '8px 12px', background: 'rgba(168, 85, 247, 0.03)', borderRadius: 6, borderLeft: '3px solid #a855f7' }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                        <Badge type="validation">Validation</Badge>
                        <span style={{ color: '#475569', fontSize: '0.75rem' }}>{log.timestamp}</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                        <MetricPill label="Val Loss" value={formatNum(parsed.val_loss as number)} />
                        {parsed.val_perplexity !== undefined && <MetricPill label="Perplexity" value={formatNum(parsed.val_perplexity as number, 1)} />}
                        {parsed.epoch !== undefined && <MetricPill label="Epoch" value={String(parsed.epoch)} />}
                    </div>
                </div>
            );
        }

        // Checkpoint/message logs
        if ('message' in parsed) {
            const msg = String(parsed.message);
            const isCheckpoint = msg.toLowerCase().includes('checkpoint') || msg.toLowerCase().includes('saved');
            return (
                <div style={{ marginBottom: 6, padding: '6px 12px', background: isCheckpoint ? 'rgba(34, 197, 94, 0.03)' : 'rgba(255,255,255,0.02)', borderRadius: 6, borderLeft: `3px solid ${isCheckpoint ? '#22c55e' : '#475569'}` }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <Badge type={isCheckpoint ? 'checkpoint' : 'info'}>{isCheckpoint ? 'Save' : 'Info'}</Badge>
                        <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>{msg}</span>
                        <span style={{ color: '#475569', fontSize: '0.7rem', marginLeft: 'auto' }}>{log.timestamp}</span>
                    </div>
                </div>
            );
        }

        // Training status (running/pid)
        if ('running' in parsed) {
            const isRunning = parsed.running as boolean;
            return (
                <div style={{ marginBottom: 6, padding: '6px 12px', background: isRunning ? 'rgba(34, 197, 94, 0.03)' : 'rgba(239, 68, 68, 0.03)', borderRadius: 6, borderLeft: `3px solid ${isRunning ? '#22c55e' : '#ef4444'}` }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <Badge type={isRunning ? 'checkpoint' : 'error'}>{isRunning ? 'Started' : 'Stopped'}</Badge>
                        <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
                            {isRunning ? `Training started (PID: ${parsed.pid})` : `Training stopped${parsed.code !== undefined ? ` (exit code: ${parsed.code})` : ''}`}
                        </span>
                        <span style={{ color: '#475569', fontSize: '0.7rem', marginLeft: 'auto' }}>{log.timestamp}</span>
                    </div>
                </div>
            );
        }

        // Warning logs
        if ('warning' in parsed) {
            return (
                <div style={{ marginBottom: 6, padding: '6px 12px', background: 'rgba(245, 158, 11, 0.03)', borderRadius: 6, borderLeft: '3px solid #f59e0b' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <Badge type="warn">Warn</Badge>
                        <span style={{ color: '#fbbf24', fontSize: '0.85rem' }}>{String(parsed.warning)}</span>
                        <span style={{ color: '#475569', fontSize: '0.7rem', marginLeft: 'auto' }}>{log.timestamp}</span>
                    </div>
                </div>
            );
        }

        // Error in JSON format
        if ('error' in parsed) {
            return (
                <div style={{ marginBottom: 6, padding: '6px 12px', background: 'rgba(239, 68, 68, 0.05)', borderRadius: 6, borderLeft: '3px solid #ef4444' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <Badge type="error">Error</Badge>
                        <span style={{ color: '#fca5a5', fontSize: '0.85rem' }}>{String(parsed.error)}</span>
                        <span style={{ color: '#475569', fontSize: '0.7rem', marginLeft: 'auto' }}>{log.timestamp}</span>
                    </div>
                </div>
            );
        }

        // Stderr messages (warnings, errors, tracebacks)
        if ('stderr' in parsed) {
            const stderr = String(parsed.stderr).trim();
            const isWarning = stderr.toLowerCase().includes('warning');
            const isTraceback = stderr.includes('Traceback') || stderr.includes('Error:') || stderr.includes('Exception');
            const badgeType = isWarning ? 'warn' : 'error';
            const label = isWarning ? 'Warn' : isTraceback ? 'Error' : 'Stderr';
            const bgColor = isWarning ? 'rgba(245, 158, 11, 0.03)' : 'rgba(239, 68, 68, 0.03)';
            const borderColor = isWarning ? '#f59e0b' : '#ef4444';
            const textColor = isWarning ? '#fbbf24' : '#fca5a5';
            return (
                <div style={{ marginBottom: 6, padding: '6px 12px', background: bgColor, borderRadius: 6, borderLeft: `3px solid ${borderColor}` }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                        <Badge type={badgeType}>{label}</Badge>
                        <ExpandableText text={stderr} color={textColor} maxLines={10} />
                        <span style={{ color: '#475569', fontSize: '0.7rem', marginLeft: 8 }}>{log.timestamp}</span>
                    </div>
                </div>
            );
        }
    }

    // Error logs
    if (log.type === 'error' || log.type === 'stderr') {
        const errorText = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
        return (
            <div style={{ marginBottom: 6, padding: '6px 12px', background: 'rgba(239, 68, 68, 0.05)', borderRadius: 6, borderLeft: '3px solid #ef4444' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                    <Badge type="error">Error</Badge>
                    <ExpandableText text={errorText} color="#fca5a5" maxLines={10} />
                </div>
                <span style={{ color: '#475569', fontSize: '0.7rem' }}>{log.timestamp}</span>
            </div>
        );
    }

    // Fallback: plain text or unknown JSON
    return (
        <div style={{ marginBottom: 4, padding: '4px 0' }}>
            <span style={{ color: '#475569', marginRight: 8, fontSize: '0.75rem' }}>[{log.timestamp}]</span>
            <span style={{ color: '#94a3b8', fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>
                {typeof payload === 'string' ? payload : JSON.stringify(payload)}
            </span>
        </div>
    );
});

// Premium SVG line chart for loss history
const LossChart = memo(function LossChart({ data }: { data: { step: number; loss: number }[] }) {
    if (data.length < 2) return null;
    const w = 400, h = 140, pad = 35;
    const minStep = data[0].step, maxStep = data[data.length - 1].step;
    const minLoss = Math.min(...data.map(d => d.loss)), maxLoss = Math.max(...data.map(d => d.loss));
    const rangeStep = maxStep - minStep || 1, rangeLoss = maxLoss - minLoss || 1;
    const toX = (s: number) => pad + ((s - minStep) / rangeStep) * (w - pad * 2);
    const toY = (l: number) => h - pad - ((l - minLoss) / rangeLoss) * (h - pad * 2);
    const points = data.map(d => `${toX(d.step)},${toY(d.loss)}`).join(' ');
    const areaPoints = `${pad},${h - pad} ${points} ${w - pad},${h - pad}`;

    return (
        <div style={{
            background: 'linear-gradient(180deg, rgba(15, 17, 26, 0.9) 0%, rgba(10, 12, 18, 0.95) 100%)',
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.06)',
            padding: '1rem',
            position: 'relative' as const,
            overflow: 'hidden'
        }}>
            <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '1px',
                background: 'linear-gradient(90deg, transparent, rgba(124, 58, 237, 0.3), transparent)'
            }} />
            <div style={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.06em',
                color: 'var(--text-muted)',
                marginBottom: '0.75rem'
            }}>
                Training Loss
            </div>
            <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', maxWidth: 500 }}>
                <defs>
                    <linearGradient id="lossGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#7c3aed" />
                        <stop offset="100%" stopColor="#ec4899" />
                    </linearGradient>
                    <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="rgba(124, 58, 237, 0.2)" />
                        <stop offset="100%" stopColor="rgba(124, 58, 237, 0)" />
                    </linearGradient>
                </defs>
                {/* Grid lines */}
                <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                {/* Area fill */}
                <polygon fill="url(#areaGradient)" points={areaPoints} />
                {/* Line */}
                <polyline fill="none" stroke="url(#lossGradient)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={points} />
                {/* Current point glow */}
                <circle cx={toX(data[data.length - 1].step)} cy={toY(data[data.length - 1].loss)} r="4" fill="#ec4899" filter="drop-shadow(0 0 4px rgba(236, 72, 153, 0.6))" />
                {/* Labels */}
                <text x={pad} y={h - 12} fill="#475569" fontSize="9" fontFamily="var(--font-mono)">{minStep}</text>
                <text x={w - pad} y={h - 12} fill="#475569" fontSize="9" fontFamily="var(--font-mono)" textAnchor="end">{maxStep}</text>
                <text x={12} y={h - pad + 4} fill="#475569" fontSize="9" fontFamily="var(--font-mono)">{minLoss.toFixed(3)}</text>
                <text x={12} y={pad + 4} fill="#475569" fontSize="9" fontFamily="var(--font-mono)">{maxLoss.toFixed(3)}</text>
            </svg>
        </div>
    );
});

export const MonitoringPanel = memo(function MonitoringPanel({ logs, metrics, lossHistory = [] }: MonitoringPanelProps) {
    const logsEndRef = useRef<HTMLDivElement>(null);
    const logsContainerRef = useRef<HTMLDivElement>(null);
    const [health, setHealth] = useState<SystemHealth | null>(null);

    useEffect(() => {
        const container = logsContainerRef.current;
        if (!container || logs.length === 0) return;
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
        if (isNearBottom) logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    useEffect(() => {
        const API = import.meta.env.VITE_API_URL || 'http://localhost:8080';
        const fetchHealth = () => fetch(`${API}/health/system`).then(r => r.ok ? r.json() : null).then(setHealth).catch(() => {});
        fetchHealth();
        const interval = setInterval(fetchHealth, 10000);
        return () => clearInterval(interval);
    }, []);

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

            {/* Loss Chart */}
            {lossHistory.length > 1 && <LossChart data={lossHistory} />}

            {/* System Health */}
            {health && (
                <div style={{
                    padding: '1rem',
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.01) 100%)',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.06)',
                    position: 'relative' as const,
                    overflow: 'hidden'
                }}>
                    <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: '1px',
                        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)'
                    }} />
                    <div style={{
                        fontSize: '0.6875rem',
                        fontWeight: 600,
                        textTransform: 'uppercase' as const,
                        letterSpacing: '0.06em',
                        color: 'var(--text-muted)',
                        marginBottom: '1rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                    }}>
                        <span style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: 'var(--success)',
                            boxShadow: '0 0 6px rgba(16, 185, 129, 0.4)'
                        }} />
                        System Health
                    </div>
                    <ProgressBar label="CPU" percent={health.cpu} />
                    <ProgressBar label="Memory" percent={health.memory.percent} detail={`${formatBytes(health.memory.used)} / ${formatBytes(health.memory.total)}`} />
                    {health.gpu && (
                        <>
                            <ProgressBar label={`GPU (${health.gpu.name.slice(0, 20)})`} percent={health.gpu.utilization} />
                            <ProgressBar label="VRAM" percent={Math.round(health.gpu.memUsed / health.gpu.memTotal * 100)} detail={`${formatBytes(health.gpu.memUsed)} / ${formatBytes(health.gpu.memTotal)}`} />
                        </>
                    )}
                </div>
            )}

            {/* File Sizes */}
    {/*}        <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
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
            <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                background: 'linear-gradient(180deg, rgba(10, 12, 18, 0.95) 0%, rgba(8, 10, 15, 0.98) 100%)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 10,
                overflow: 'hidden',
                minHeight: 350,
                position: 'relative' as const
            }}>
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: '1px',
                    background: 'linear-gradient(90deg, transparent, rgba(124, 58, 237, 0.4), rgba(236, 72, 153, 0.3), transparent)'
                }} />
                <div style={{
                    padding: '0.75rem 1rem',
                    background: 'rgba(255,255,255,0.02)',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: logs.length > 0 ? '#22c55e' : '#475569',
                            boxShadow: logs.length > 0 ? '0 0 8px rgba(34, 197, 94, 0.5), 0 0 12px rgba(34, 197, 94, 0.3)' : 'none',
                            animation: logs.length > 0 ? 'pulse-glow 2s ease-in-out infinite' : 'none'
                        }} />
                        <span style={{
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                            textTransform: 'uppercase' as const,
                            letterSpacing: '0.04em'
                        }}>Training Log</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{
                            fontSize: '0.6875rem',
                            color: 'var(--text-muted)',
                            fontFamily: 'var(--font-mono)'
                        }}>{logs.length} entries</span>
                        {logs.length > 0 && (
                            <button
                                onClick={() => {
                                    const text = logs.map(l => {
                                        const p = typeof l.payload === 'string' ? l.payload : JSON.stringify(l.payload);
                                        return `[${l.timestamp}] ${p}`;
                                    }).join('\n');
                                    const blob = new Blob([text], { type: 'text/plain' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url; a.download = `madlab-logs-${new Date().toISOString().slice(0, 10)}.txt`; a.click();
                                    URL.revokeObjectURL(url);
                                }}
                                style={{
                                    fontSize: '0.6875rem',
                                    padding: '0.25rem 0.625rem',
                                    background: 'transparent',
                                    border: '1px solid var(--border)',
                                    borderRadius: 5,
                                    color: 'var(--text-muted)',
                                    cursor: 'pointer'
                                }}
                                title="Export logs"
                            >Export</button>
                        )}
                    </div>
                </div>
                <div ref={logsContainerRef} style={{ flex: 1, padding: '0.75rem 1rem', overflowY: 'auto' }}>
                    {logs.length === 0 ? (
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100%',
                            color: 'var(--text-muted)'
                        }}>
                            <div style={{
                                width: 48,
                                height: 48,
                                borderRadius: '50%',
                                border: '2px solid var(--border)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                marginBottom: 12
                            }}>
                                <div style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: '50%',
                                    background: 'var(--border-accent)'
                                }} />
                            </div>
                            <div style={{ fontSize: '0.8125rem' }}>Waiting for training logs...</div>
                        </div>
                    ) : (
                        logs.map(log => <LogEntry key={log.id} log={log} />)
                    )}
                    <div ref={logsEndRef} />
                </div>
            </div>

        </div>
    );
});
