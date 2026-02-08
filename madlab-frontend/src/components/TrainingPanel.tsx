import { useState, useEffect, useCallback, useRef } from 'react';
import { ModelBrowser } from './ModelBrowser';
import { DatasetGenerator } from './DatasetGenerator';
import { usePolling, useEscapeKey } from '../hooks';
import type { TrainingStatus, TrainingConfig, DatasetInfo, ModelArtifact, TrainingMetrics } from '../types';

interface TrainingPanelProps {
    metrics?: TrainingMetrics;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';


const PRESETS = {
    'Custom': null,
    'Quick Test': { epochs: 1, batch_size: 4, save_every: 50 },
    'Small Model (<1B)': { batch_size: 8, lr: 5e-5, grad_accum_steps: 2 },
    'Large Model (>2B)': { batch_size: 2, lr: 2e-5, grad_accum_steps: 8 },
    'Quality Fine-tune': { epochs: 3, lr: 3e-5 },
} as const;

type PresetKey = keyof typeof PRESETS;

export function TrainingPanel({ metrics }: TrainingPanelProps) {
    const [status, setStatus] = useState<TrainingStatus>({ running: false });
    const [loading, setLoading] = useState(false);
    const [showModelBrowser, setShowModelBrowser] = useState(false);
    const [showGenerator, setShowGenerator] = useState(false);
    const [hfRepo, setHfRepo] = useState('');
    const [processing, setProcessing] = useState(false);
    const [split, setSplit] = useState('train');
    const [error, setError] = useState<string | null>(null);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);
    const [selectedPreset, setSelectedPreset] = useState<PresetKey>('Custom');

    // Progress tracking
    const startTime = useRef<number | null>(null);
    const epochTimes = useRef<number[]>([]);
    const lastEpoch = useRef<number>(0);
    const wasRunning = useRef<boolean>(false);  // Track previous running state

    // Restore timing state from localStorage on mount
    useEffect(() => {
        const saved = localStorage.getItem('madlab_training_timing');
        if (saved) {
            try {
                const { startTime: s, epochTimes: e, lastEpoch: l } = JSON.parse(saved);
                startTime.current = s;
                epochTimes.current = e || [];
                lastEpoch.current = l || 0;
            } catch {}
        }
    }, []);

    // Persist timing state to localStorage when training
    useEffect(() => {
        if (status.running && startTime.current) {
            localStorage.setItem('madlab_training_timing', JSON.stringify({
                startTime: startTime.current,
                epochTimes: epochTimes.current,
                lastEpoch: lastEpoch.current
            }));
        }
    }, [status.running, metrics?.epoch]);

    // Clear status message after 3s
    useEffect(() => {
        if (statusMsg) {
            const t = setTimeout(() => setStatusMsg(null), 3000);
            return () => clearTimeout(t);
        }
    }, [statusMsg]);

    // Clear error after 5s
    useEffect(() => {
        if (error) {
            const t = setTimeout(() => setError(null), 5000);
            return () => clearTimeout(t);
        }
    }, [error]);

    // Track epoch progress for ETA - only reset on actual stop (running -> not running)
    useEffect(() => {
        const isRunning = status.running;
        
        if (!isRunning && wasRunning.current) {
            // Training actually stopped - reset timer and clear persistence
            startTime.current = null;
            epochTimes.current = [];
            lastEpoch.current = 0;
            localStorage.removeItem('madlab_training_timing');
        } else if (isRunning && !startTime.current) {
            // Training started or resumed without a timer - initialize
            startTime.current = Date.now();
        }
        
        // Track epoch changes
        if (isRunning) {
            const epoch = Math.floor(metrics?.epoch ?? 0);
            if (epoch > lastEpoch.current) {
                epochTimes.current.push(Date.now());
                lastEpoch.current = epoch;
            }
        }
        
        wasRunning.current = isRunning;
    }, [status.running, metrics?.epoch]);

    // Force re-render every second for elapsed time display
    const [, forceUpdate] = useState(0);
    useEffect(() => {
        if (!status.running) return;
        const t = setInterval(() => forceUpdate(n => n + 1), 1000);
        return () => clearInterval(t);
    }, [status.running]);

    const fetchStatus = useCallback(async () => {
        try {
            const res = await fetch(`${API_URL}/train/status`);
            if (!res.ok) throw new Error('Failed to fetch status');
            setStatus(await res.json());
        } catch (e) {
            console.error(e);
            setError('Failed to fetch training status');
        }
    }, []);

    usePolling(fetchStatus, 2000);

    const handleStart = async () => {
        setLoading(true);
        try {
            // Auto-save config before starting (ensures GPU selection is applied)
            if (configData) {
                await fetch(`${API_URL}/train/config`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(configData)
                });
            }
            const res = await fetch(`${API_URL}/train/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ configPath: 'config/train.yaml' })
            });
            if (!res.ok) throw new Error('Failed to start training');
            setStatusMsg('Training started');
        } catch (e) {
            setError('Failed to start training');
        } finally {
            setLoading(false);
        }
    };

    const handleStop = async () => {
        try {
            const res = await fetch(`${API_URL}/train/stop`, { method: 'POST' });
            if (!res.ok) throw new Error('Failed to stop training');
            setStatusMsg('Training stopped');
        } catch (e) {
            setError('Failed to stop training');
        }
    };

    const [artifacts, setArtifacts] = useState<ModelArtifact[]>([]);

    const fetchArtifacts = useCallback(async () => {
        try {
            const res = await fetch(`${API_URL}/train/artifacts`);
            if (!res.ok) throw new Error('Failed to fetch artifacts');
            setArtifacts(await res.json());
        } catch (e) {
            console.error('Failed to fetch artifacts:', e);
        }
    }, []);

    usePolling(fetchArtifacts, 5000);

    const convertModel = async (quant: string) => {
        await fetch(`${API_URL}/train/convert`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ quantization: quant })
        });
    };

    const evaluateModel = async (_name: string, quant: string) => {
        await fetch(`${API_URL}/train/evaluate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ modelName: 'tuned', quantization: quant })
        });
    };

    const [configData, setConfigData] = useState<TrainingConfig | null>(null);
    const [saving, setSaving] = useState(false);
    const [suggesting, setSuggesting] = useState(false);

    // GPU devices
    const [availableGpus, setAvailableGpus] = useState<{ index: number; name: string; memTotal: number; memFree: number; device: string }[]>([]);
    const [selectedDatasets, setSelectedDatasets] = useState<Set<string>>(new Set());

    // Compute progress values
    const totalEpochs = configData?.train.epochs ?? 1;
    const currentEpoch = metrics?.epoch ?? 0;
    const progress = Math.min((currentEpoch / totalEpochs) * 100, 100);
    const elapsed = startTime.current ? Math.floor((Date.now() - startTime.current) / 1000) : 0;
    const avgEpochTime = epochTimes.current.length > 1
        ? (epochTimes.current[epochTimes.current.length - 1] - epochTimes.current[0]) / (epochTimes.current.length - 1)
        : 0;
    const remainingEpochs = totalEpochs - currentEpoch;
    const eta = avgEpochTime > 0 ? Math.floor((remainingEpochs * avgEpochTime) / 1000) : null;
    const fmtTime = (s: number) => `${Math.floor(s / 60)}m ${s % 60}s`;

    // Judge State
    const [judgeLimit, setJudgeLimit] = useState(20);
    const [judgeSharpness, setJudgeSharpness] = useState(50);

    // Report viewer
    const [viewingReport, setViewingReport] = useState<{ name: string; data: any } | null>(null);

    // Dataset preview
    const [previewData, setPreviewData] = useState<{ name: string; samples: any[]; stats: any; errors: string[] } | null>(null);

    const handleJudge = async (modelName: string, quantization: string) => {
        try {
            const res = await fetch(`${API_URL}/train/judge`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    modelName,
                    quantization,
                    limit: judgeLimit / 100,
                    sharpness: judgeSharpness
                })
            });
            if (!res.ok) throw new Error('Failed to start Magic Judge');
            setStatusMsg('Magic Judge started! Check Monitoring tab.');
        } catch (e) {
            console.error(e);
            setError('Failed to start Magic Judge');
        }
    };

    const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
    const [datasetsLoaded, setDatasetsLoaded] = useState(false);
    const [modelHistory, setModelHistory] = useState<string[]>([]);

    const fetchConfig = useCallback(async () => {
        try {
            const res = await fetch(`${API_URL}/train/config`);
            if (!res.ok) throw new Error('Failed to fetch config');
            const data = await res.json();
            setConfigData(data);
            return true;
        } catch (e) {
            console.error(e);
            setError('Failed to load training config');
            return false;
        }
    }, []);

    const fetchDatasets = useCallback(async () => {
        try {
            const res = await fetch(`${API_URL}/datasets`);
            if (!res.ok) throw new Error('Failed to fetch datasets');
            const data = await res.json();
            setDatasets(data);
            setDatasetsLoaded(true);
            return true;
        } catch (e) {
            console.error('Failed to fetch datasets:', e);
            setError('Failed to load datasets');
            return false;
        }
    }, []);

    const fetchHistory = useCallback(async () => {
        try {
            const res = await fetch(`${API_URL}/train/history`);
            if (!res.ok) throw new Error('Failed to fetch history');
            const data = await res.json();
            setModelHistory(data);
        } catch (e) {
            console.error('Failed to fetch history:', e);
        }
    }, []);

    const fetchGpus = useCallback(async () => {
        try {
            const res = await fetch(`${API_URL}/health/gpus`);
            if (res.ok) setAvailableGpus(await res.json());
        } catch { /* no GPUs available */ }
    }, []);

    // Initial fetch + retry if failed
    useEffect(() => {
        fetchConfig();
        fetchDatasets();
        fetchHistory();
        fetchGpus();
    }, [fetchConfig, fetchDatasets, fetchHistory, fetchGpus]);

    // Retry fetch if config/datasets failed to load (every 5s until success)
    useEffect(() => {
        if (configData && datasetsLoaded) return;
        const t = setInterval(() => {
            if (!configData) fetchConfig();
            if (!datasetsLoaded) fetchDatasets();
        }, 5000);
        return () => clearInterval(t);
    }, [configData, datasetsLoaded, fetchConfig, fetchDatasets]);

    const updateConfig = useCallback((section: keyof TrainingConfig, key: string, value: string | number | boolean) => {
        setSelectedPreset('Custom');
        setConfigData(prev => {
            if (!prev) return prev;
            return {
                ...prev,
                [section]: {
                    ...prev[section],
                    [key]: value
                }
            };
        });
    }, []);

    const applyPreset = (preset: PresetKey) => {
        setSelectedPreset(preset);
        const values = PRESETS[preset];
        if (!values || !configData) return;
        setConfigData(prev => prev ? { ...prev, train: { ...prev.train, ...values } } : prev);
    };

    const saveConfig = async () => {
        setSaving(true);
        try {
            await fetch(`${API_URL}/train/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(configData)
            });
        } catch (e) {
            console.error(e);
        } finally {
            setSaving(false);
        }
    };

    const suggestHyperparams = async () => {
        if (!configData) return;
        setSuggesting(true);
        try {
            const res = await fetch(`${API_URL}/train/suggest-hyperparams`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_name: configData.model.name, dataset_rows: datasets.find(d => d.selected)?.size })
            });
            if (!res.ok) throw new Error('Failed to get suggestions');
            const suggestions = await res.json();
            setConfigData(prev => prev ? { ...prev, train: { ...prev.train, epochs: suggestions.epochs || prev.train.epochs, lr: suggestions.learning_rate || prev.train.lr, batch_size: suggestions.batch_size || prev.train.batch_size, grad_accum_steps: suggestions.grad_accum_steps || prev.train.grad_accum_steps } } : prev);
            setSelectedPreset('Custom');
            if (suggestions.reasoning) setStatusMsg(suggestions.reasoning);
        } catch (e) { setError('Failed to get hyperparameter suggestions'); }
        finally { setSuggesting(false); }
    };

    const handleImport = async () => {
        if (!hfRepo) return;
        setProcessing(true);
        try {
            await fetch(`${API_URL}/datasets/import`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repo: hfRepo, split: split || 'train' })
            });
            setHfRepo('');
            fetchDatasets();
        } catch (e) { console.error(e); }
        finally { setProcessing(false); }
    };

    const handleClean = async (filename: string) => {
        if (!confirm(`Deduplicate and clean ${filename}?`)) return;
        setProcessing(true);
        try {
            await fetch(`${API_URL}/datasets/clean`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename })
            });
            fetchDatasets();
        } catch (e) { console.error(e); }
        finally { setProcessing(false); }
    };

    const handleDelete = async (filename: string) => {
        if (!confirm(`Delete ${filename}?`)) return;
        setProcessing(true);
        try {
            await fetch(`${API_URL}/datasets/${filename}`, { method: 'DELETE' });
            fetchDatasets();
        } catch (e) { console.error(e); }
        finally { setProcessing(false); }
    };

    useEscapeKey(!!viewingReport, () => setViewingReport(null));

    return (
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {error && (
                <div style={{ position: 'fixed', top: '4rem', left: '50%', transform: 'translateX(-50%)', zIndex: 999, minWidth: '300px', maxWidth: '500px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', background: '#7f1d1d', color: '#fecaca', padding: '0.75rem 1rem', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{error}</span>
                    <button onClick={() => setError(null)} style={{ background: 'transparent', border: 'none', color: '#fecaca', cursor: 'pointer', fontSize: '1.2rem' }}>&times;</button>
                </div>
            )}
            {statusMsg && (
                <div style={{ background: '#14532d', color: '#bbf7d0', padding: '0.75rem 1rem', borderRadius: '6px' }}>{statusMsg}</div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                <div>
                    <h2>Training Control 🛠</h2>

                    {configData && (
                        <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label>
                                Config Preset
                                <select value={selectedPreset} onChange={e => applyPreset(e.target.value as PresetKey)}>
                                    {Object.keys(PRESETS).map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                            </label>
                            <label>
                                Base Model
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <input
                                        list="models"
                                        value={configData.model.name}
                                        onChange={e => updateConfig('model', 'name', e.target.value)}
                                        placeholder="HuggingFace Repo ID"
                                        style={{ flex: 1 }}
                                    />
                                    <button onClick={() => setShowModelBrowser(true)}>Browse HF🤗</button>
                                </div>
                                <datalist id="models">
                                    <span>Judge Sharpness</span>
                                    {modelHistory.map(m => <option key={m} value={m} label='Last model' />)}
                                    <option value="LiquidAI/LFM2-350M" />
                                    <option value="LiquidAI/LFM2-700M" />
                                    <option value="LiquidAI/LFM2-1.2B" />
                                    <option value="LiquidAI/LFM2-2.6B" />
                                    <option value="TinyLlama/TinyLlama-1.1B-Chat-v1.0" />                                    
                                </datalist>
                            </label>

                            {showModelBrowser && (
                                <ModelBrowser
                                    onSelect={(id) => updateConfig('model', 'name', id)}
                                    onClose={() => setShowModelBrowser(false)}
                                />
                            )}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                            <label>
                                Device
                                <select value={configData.runtime.device} onChange={e => updateConfig('runtime', 'device', e.target.value)}>
                                    <option value="cpu">CPU</option>
                                    {availableGpus.length > 0 ? (
                                        availableGpus.map(gpu => (
                                            <option key={gpu.device} value={gpu.device}>
                                                {gpu.device} - {gpu.name} ({Math.round(gpu.memFree / 1024)}GB free)
                                            </option>
                                        ))
                                    ) : (
                                        <option value="cuda">CUDA (auto)</option>
                                    )}
                                </select>
                            </label>
                            <label>
                                Workers
                                <input type="number" min="0" max="64" value={configData.runtime.workers || 0} onChange={e => updateConfig('runtime', 'workers', parseInt(e.target.value) || 0)} />
                            </label>
                            <label>
                                Adapter
                                <select value={configData.model.adapter} onChange={e => updateConfig('model', 'adapter', e.target.value)}>
                                    <option value="none">None</option>
                                    <option value="Lora">Lora</option>
                                </select>
                            </label>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                                <label>
                                    Epochs
                                    <input type="number" min="1" max="100" value={configData.train.epochs} onChange={e => updateConfig('train', 'epochs', parseInt(e.target.value) || 1)} />
                                </label>
                                <label>
                                    Batch Size
                                    <input type="number" min="1" max="64" value={configData.train.batch_size} onChange={e => updateConfig('train', 'batch_size', parseInt(e.target.value) || 1)} />
                                </label>
                                <label>
                                    Max Samples
                                    <input type="number" min="0" max="1000000" value={configData.data.max_samples || 0} onChange={e => updateConfig('data', 'max_samples', parseInt(e.target.value) || 0)} placeholder="0 = all" />
                                </label>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                                <label>
                                    Learning Rate
                                    <input type="number" min="0.000001" max="0.01" step="0.00001" value={configData.train.lr} onChange={e => updateConfig('train', 'lr', parseFloat(e.target.value) || 0.00005)} />
                                </label>
                                <label>
                                    Max Seq Len
                                    <input type="number" min="64" max="8192" value={configData.train.max_seq_len} onChange={e => updateConfig('train', 'max_seq_len', parseInt(e.target.value) || 512)} />
                                </label>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                            <label>
                                Save Every
                                <input type="number" min="1" max="4096" value={configData.train.save_every || 100} onChange={e => updateConfig('train', 'save_every', parseInt(e.target.value) || 1)} />
                            </label>
                            <label>
                                Gradual Accumulation
                                <input type="number" min="0" max="64" value={configData.train.grad_accum_steps || 1} onChange={e => updateConfig('train', 'grad_accum_steps', parseInt(e.target.value) || 1)} />
                            </label>
                            </div>

                            {/* Advanced Settings */}
                            <details style={{ marginTop: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: '6px' }}>
                                <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: '0.5rem' }}>⚙️ Advanced Settings</summary>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                                    <label>
                                        Optimizer
                                        <select value={configData.train.optimizer || 'adamw'} onChange={e => updateConfig('train', 'optimizer', e.target.value)}>
                                            <option value="adamw">AdamW</option>
                                            <option value="adamw_8bit">AdamW 8-bit (saves VRAM)</option>
                                            <option value="paged_adamw_8bit">Paged AdamW 8-bit</option>
                                            <option value="adamw_fused">AdamW Fused (fastest)</option>
                                        </select>
                                    </label>
                                    <label>
                                        LR Scheduler
                                        <select value={configData.train.lr_scheduler || 'linear'} onChange={e => updateConfig('train', 'lr_scheduler', e.target.value)}>
                                            <option value="linear">Linear</option>
                                            <option value="cosine">Cosine (recommended)</option>
                                            <option value="constant">Constant</option>
                                        </select>
                                    </label>
                                    <label>
                                        Precision
                                        <select
                                            value={configData.precision?.bf16 ? 'bf16' : configData.precision?.fp16 ? 'fp16' : 'fp32'}
                                            onChange={e => {
                                                const v = e.target.value;
                                                setConfigData(prev => prev ? { ...prev, precision: { fp16: v === 'fp16', bf16: v === 'bf16', fp32: v === 'fp32' } } : prev);
                                                setSelectedPreset('Custom');
                                            }}
                                        >
                                            <option value="fp16">FP16 (fast)</option>
                                            <option value="bf16">BF16 (modern GPUs)</option>
                                            <option value="fp32">FP32 (full precision)</option>
                                        </select>
                                    </label>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                                    <label>
                                        Early Stop Patience
                                        <input type="number" min="0" max="20" value={configData.train.early_stopping_patience || 0} onChange={e => updateConfig('train', 'early_stopping_patience', parseInt(e.target.value) || 0)} title="Stop if val loss doesn't improve for N epochs (0=disabled)" />
                                    </label>
                                    <label>
                                        Max Checkpoints
                                        <input type="number" min="1" max="20" value={configData.train.save_total_limit || 3} onChange={e => updateConfig('train', 'save_total_limit', parseInt(e.target.value) || 3)} title="Keep last N checkpoints" />
                                    </label>
                                </div>
                                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                        <input type="checkbox" checked={!!configData.train.packing} onChange={e => updateConfig('train', 'packing', e.target.checked)} />
                                        <span title="Concatenate samples for 1.5-3x speedup">Packing (faster)</span>
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                        <input type="checkbox" checked={!!configData.train.gradient_checkpointing} onChange={e => updateConfig('train', 'gradient_checkpointing', e.target.checked)} />
                                        <span title="Trade compute for VRAM savings">Grad Checkpointing</span>
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                        <input type="checkbox" checked={!!configData.train.save_best_only} onChange={e => updateConfig('train', 'save_best_only', e.target.checked)} />
                                        <span title="Only save best validation checkpoint">Save Best Only</span>
                                    </label>
                                </div>
                            </details>

                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                <button onClick={saveConfig} disabled={saving || status.running}>
                                    {saving ? 'Saving...' : 'Save Configuration'}
                                </button>
                                <button onClick={suggestHyperparams} disabled={suggesting || status.running} title="Get LLM-suggested hyperparameters">
                                    {suggesting ? 'Asking LLM...' : 'Suggest'}
                                </button>
                            </div>
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '1rem' }}>
                        {!status.running ? (
                            <button className="primary" onClick={handleStart} disabled={loading} style={{ minWidth: '140px' }}>
                                {loading ? 'Starting...' : '▶ Start Training'}
                            </button>
                        ) : (
                            <button
                                onClick={handleStop}
                                style={{
                                    background: 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)',
                                    color: 'white',
                                    border: 'none',
                                    boxShadow: '0 4px 12px rgba(239, 68, 68, 0.3)',
                                    minWidth: '140px'
                                }}
                            >
                               ⏹ Stop Training
                            </button>
                        )}

                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.625rem',
                            padding: '0.375rem 0.875rem',
                            background: status.running ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255,255,255,0.03)',
                            borderRadius: '20px',
                            border: `1px solid ${status.running ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.06)'}`
                        }}>
                            <div style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: status.running ? 'var(--success)' : 'var(--text-muted)',
                                boxShadow: status.running ? '0 0 8px rgba(16, 185, 129, 0.5)' : 'none',
                                animation: status.running ? 'pulse-glow 2s ease-in-out infinite' : 'none'
                            }} />
                            <span style={{
                                fontSize: '0.75rem',
                                fontWeight: 500,
                                color: status.running ? 'var(--success)' : 'var(--text-muted)'
                            }}>
                                {status.running ? `Running (PID: ${status.pid})` : 'Idle'}
                            </span>
                        </div>
                    </div>

                    {status.running && (
                        <div style={{
                            marginTop: '1rem',
                            background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.08) 0%, rgba(236, 72, 153, 0.05) 100%)',
                            padding: '1rem',
                            borderRadius: '10px',
                            border: '1px solid rgba(124, 58, 237, 0.2)',
                            position: 'relative' as const,
                            overflow: 'hidden'
                        }}>
                            <div style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                height: '2px',
                                background: 'linear-gradient(90deg, var(--primary), var(--secondary))',
                                opacity: 0.6
                            }} />
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                marginBottom: '0.625rem',
                                fontSize: '0.8125rem'
                            }}>
                                <span style={{ fontWeight: 500 }}>Epoch {currentEpoch.toFixed(2)} / {totalEpochs}</span>
                                <span style={{
                                    fontFamily: 'var(--font-mono)',
                                    fontWeight: 600,
                                    background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
                                    WebkitBackgroundClip: 'text',
                                    WebkitTextFillColor: 'transparent'
                                }}>{progress.toFixed(1)}%</span>
                            </div>
                            <div style={{
                                background: 'rgba(0,0,0,0.3)',
                                borderRadius: '6px',
                                height: '10px',
                                overflow: 'hidden',
                                border: '1px solid rgba(255,255,255,0.04)'
                            }}>
                                <div style={{
                                    background: 'linear-gradient(90deg, var(--primary), var(--secondary))',
                                    width: `${progress}%`,
                                    height: '100%',
                                    transition: 'width 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                                    borderRadius: '5px',
                                    boxShadow: '0 0 12px rgba(124, 58, 237, 0.4)'
                                }} />
                            </div>
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                marginTop: '0.625rem',
                                fontSize: '0.75rem',
                                color: 'var(--text-muted)'
                            }}>
                                <span style={{ fontFamily: 'var(--font-mono)' }}>⏱ {fmtTime(elapsed)}</span>
                                <span style={{ fontFamily: 'var(--font-mono)' }}>
                                    {eta !== null ? `ETA ${fmtTime(eta)}` : 'Calculating...'}
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                <div>
                    <h2>Dataset Management 📁</h2>
                    <div style={{ marginBottom: '1rem', background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                            <input type="file" id="datasetUpload" multiple accept=".jsonl,.json" style={{ display: 'none' }} onChange={async (e) => {
                                if (e.target.files && e.target.files.length > 0) {
                                    for (const file of Array.from(e.target.files)) {
                                        const formData = new FormData();
                                        formData.append('file', file);
                                        await fetch(`${API_URL}/datasets/upload`, { method: 'POST', body: formData });
                                    }
                                    fetchDatasets();
                                    e.target.value = ''; // Reset for re-upload
                                }
                            }} />
                            <label htmlFor="datasetUpload" className="button" style={{ cursor: 'pointer', background: '#3b82f6', padding: '0.5rem 1rem', borderRadius: '4px', color: 'white' }}>
                               📂 Upload .jsonl (multi)
                            </label>
                            <button onClick={() => setShowGenerator(true)} style={{ background: '#8b5cf6', color: 'white' }}>
                                ✨ Generate Synthetic Data
                            </button>
                            <button onClick={() => fetchDatasets()}>Refresh</button>
                        </div>

                        {showGenerator && (
                            <div style={{ marginBottom: '1rem' }}>
                                <div style={{ display: 'flex', justifySelf: 'end', marginBottom: '0.5rem' }}>
                                    <button onClick={() => setShowGenerator(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8' }}>Close Generator</button>
                                </div>
                                <DatasetGenerator onDatasetGenerated={() => { fetchDatasets(); }} />
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center' }}>
                            <input
                                value={hfRepo}
                                onChange={e => setHfRepo(e.target.value)}
                                placeholder="HF Dataset Repo (e.g. 'fka/awesome-chatgpt-prompts')..."
                                style={{ flex: 1, padding: '0.5rem', borderRadius: '4px', border: '1px solid #475569', background: '#0f172a', color: 'white' }}
                            />
                            <input
                                value={split}
                                onChange={e => setSplit(e.target.value)}
                                placeholder="Split (default: train)"
                                style={{ width: '100px', padding: '0.5rem', borderRadius: '4px', border: '1px solid #475569', background: '#0f172a', color: 'white' }}
                            />
                            <button onClick={handleImport} disabled={processing || !hfRepo} style={{ background: '#0ea5e9', color: 'white' }}>
                                ⬇️ Import
                            </button>
                            <button onClick={async () => {
                                if (!hfRepo) return;
                                setProcessing(true);
                                try {
                                    const res = await fetch(`${API_URL}/datasets/smart_import`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ repo: hfRepo, split: split || 'train' })
                                    });
                                    if (!res.ok) throw new Error((await res.json()).error);
                                    setHfRepo('');
                                    setStatusMsg('Dataset imported successfully');
                                    fetchDatasets();
                                } catch (e) { setError(e instanceof Error ? e.message : 'Import failed'); }
                                finally { setProcessing(false); }
                            }} disabled={processing || !hfRepo} style={{ background: '#ec4899', color: 'white', marginLeft: '0.5rem' }}>
                                🪄 Magic Import
                            </button>
                        </div>

                        {/* Merge selected button */}
                        {selectedDatasets.size > 1 && (
                            <button
                                onClick={async () => {
                                    setProcessing(true);
                                    try {
                                        const res = await fetch(`${API_URL}/datasets/merge`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ filenames: Array.from(selectedDatasets) })
                                        });
                                        if (!res.ok) throw new Error('Merge failed');
                                        const { filename, totalLines } = await res.json();
                                        setStatusMsg(`Merged ${selectedDatasets.size} files → ${filename} (${totalLines} samples)`);
                                        setSelectedDatasets(new Set());
                                        fetchDatasets();
                                        fetchConfig();
                                    } catch (e) { setError(e instanceof Error ? e.message : 'Merge failed'); }
                                    finally { setProcessing(false); }
                                }}
                                disabled={processing}
                                style={{ marginBottom: '0.5rem', background: '#8b5cf6', color: 'white', padding: '0.5rem 1rem' }}
                            >
                                🔗 Merge {selectedDatasets.size} Selected & Use for Training
                            </button>
                        )}

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                            {datasets.map(d => (
                                <div key={d.name} style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '0.5rem', borderRadius: '4px',
                                    background: d.selected ? 'rgba(59, 130, 246, 0.2)' : selectedDatasets.has(d.name) ? 'rgba(139, 92, 246, 0.1)' : 'transparent',
                                    border: d.selected ? '1px solid #3b82f6' : selectedDatasets.has(d.name) ? '1px solid #8b5cf6' : '1px solid transparent'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <input
                                            type="checkbox"
                                            checked={selectedDatasets.has(d.name)}
                                            onChange={e => {
                                                const newSet = new Set(selectedDatasets);
                                                e.target.checked ? newSet.add(d.name) : newSet.delete(d.name);
                                                setSelectedDatasets(newSet);
                                            }}
                                            style={{ width: 16, height: 16 }}
                                        />
                                        <div>
                                            <div style={{ fontWeight: 'bold' }}>{d.name}</div>
                                            <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{(d.size / 1024).toFixed(1)} KB</div>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <button onClick={async () => {
                                            const res = await fetch(`${API_URL}/datasets/${d.name}/preview?limit=5`);
                                            if (res.ok) setPreviewData({ name: d.name, ...(await res.json()) });
                                        }} style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', background: '#6366f1' }}>👁️</button>
                                        <button onClick={() => handleDelete(d.name)} disabled={processing} style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', background: '#ef4444' }}>🗑️</button>
                                        <button onClick={() => handleClean(d.name)} disabled={processing} style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', background: '#334155' }}>🧹 Clean</button>

                                        {!d.selected && (
                                            <button onClick={async () => {
                                                await fetch(`${API_URL}/datasets/select`, {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ filename: d.name })
                                                });
                                                fetchDatasets();
                                                fetchConfig();
                                            }}>Use</button>
                                        )}
                                        {d.selected && <span style={{ color: '#3b82f6', fontSize: '0.8rem', fontWeight: 600 }}>● Active</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <h2>Magic Judge Controls 🪄</h2>
                    <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div>
                            <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>Evaluation Limit</span>
                                <span>{judgeLimit}%</span>
                            </label>
                            <input
                                type="range" min="1" max="100"
                                value={judgeLimit}
                                onChange={e => setJudgeLimit(parseInt(e.target.value))}
                                style={{ width: '100%' }}
                            />
                            <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>Percentage of validation set to judge.</p>
                        </div>
                        <div>
                            <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>Judge Sharpness</span>
                                <span>{judgeSharpness < 30 ? 'Lax 😌' : judgeSharpness > 70 ? 'Harsh 😠' : 'Balanced 😐'} ({judgeSharpness}%)</span>
                            </label>
                            <input
                                type="range" min="0" max="100"
                                value={judgeSharpness}
                                onChange={e => setJudgeSharpness(parseInt(e.target.value))}
                                style={{ width: '100%' }}
                            />
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#94a3b8' }}>
                                <span>Lax (Creative)</span>
                                <span>Harsh (Strict)</span>
                            </div>
                        </div>
                    </div>

                    <h2>GGUF Automation 📦</h2>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                        <button onClick={() => convertModel('f16')}>Convert f16 (Base)</button>
                        <button onClick={() => convertModel('q8_0')}>Convert Q8_0 (Quantized)</button>
                    </div>

                    <h3>Artifacts</h3>
                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                        {artifacts.map(f => (
                            <div key={f.name} style={{ background: 'rgba(255,255,255,0.05)', padding: '0.5rem', borderRadius: '4px', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <a href={`${API_URL}${f.url}`} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa' }}>{f.name}</a>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        {f.name.endsWith('.json') && (
                                            <button onClick={async () => {
                                                const res = await fetch(`${API_URL}${f.url}`);
                                                const data = await res.json();
                                                setViewingReport({ name: f.name, data });
                                            }}>🔍 View</button>
                                        )}
                                        {f.name.endsWith('.gguf') && (
                                            <>
                                                <button onClick={() => evaluateModel(f.name.replace(`-${f.name.includes('f16') ? 'f16' : 'q8_0'}.gguf`, ''), f.name.includes('f16') ? 'f16' : 'q8_0')}>
                                                    Eval (Static)
                                                </button>
                                                <button
                                                    onClick={() => handleJudge(f.name.replace(`-${f.name.includes('f16') ? 'f16' : 'q8_0'}.gguf`, ''), f.name.includes('f16') ? 'f16' : 'q8_0')}
                                                    style={{ background: 'linear-gradient(45deg, #6366f1, #a855f7)' }}
                                                >
                                                    🪄 Magic Judge
                                                </button>
                                                <button
                                                    onClick={async () => {
                                                        const quant = f.name.includes('f16') ? 'f16' : 'q8_0';
                                                        const modelName = f.name.replace(`-${quant}.gguf`, '');
                                                        const res = await fetch(`${API_URL}/train/export-bundle`, {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ modelName, quantization: quant })
                                                        });
                                                        if (!res.ok) { setError('Export failed'); return; }
                                                        const blob = await res.blob();
                                                        const url = URL.createObjectURL(blob);
                                                        const a = document.createElement('a');
                                                        a.href = url; a.download = `${modelName}-bundle.zip`; a.click();
                                                        URL.revokeObjectURL(url);
                                                    }}
                                                    style={{ background: '#059669' }}
                                                >
                                                    📦 Export Bundle
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                        {artifacts.length === 0 && <span style={{ color: '#64748b' }}>No artifacts found</span>}
                    </div>
                </div>
            </div>

            {viewingReport && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div style={{ background: '#1e293b', padding: '2rem', borderRadius: '8px', maxWidth: '600px', maxHeight: '80vh', overflow: 'auto' }}>
                        <h3>{viewingReport.name}</h3>
                        <div style={{ marginBottom: '1rem' }}>
                            <strong>Accuracy:</strong> {((viewingReport.data.accuracy ?? viewingReport.data.static_accuracy) * 100).toFixed(1)}%
                            {viewingReport.data.average_score !== undefined && <><br/><strong>Judge Score:</strong> {viewingReport.data.average_score.toFixed(1)}/10</>}
                            {viewingReport.data.capability_index !== undefined && <><br/><strong>Capability Index:</strong> {viewingReport.data.capability_index.toFixed(1)}/100</>}
                        </div>
                        <h4>Worst Samples</h4>
                        {viewingReport.data.samples?.filter((s: any) => !s.correct || (s.judgment?.score ?? 10) < 5).slice(0, 10).map((s: any) => (
                            <div key={`${s.input}-${s.target}`.slice(0, 100)} style={{ background: 'rgba(0,0,0,0.3)', padding: '0.5rem', marginBottom: '0.5rem', borderRadius: '4px', fontSize: '0.85rem' }}>
                                <div><strong>Input:</strong> {s.input}</div>
                                <div><strong>Target:</strong> {s.target}</div>
                                <div><strong>Output:</strong> {s.output}</div>
                                {s.judgment && <div><strong>Score:</strong> {s.judgment.score}/10 - {s.judgment.reason}</div>}
                            </div>
                        ))}
                        <button onClick={() => setViewingReport(null)} style={{ marginTop: '1rem' }}>Close</button>
                    </div>
                </div>
            )}

            {previewData && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setPreviewData(null)}>
                    <div style={{ background: '#1e293b', padding: '2rem', borderRadius: '8px', maxWidth: '700px', maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
                        <h3>Preview: {previewData.name}</h3>
                        <div style={{ marginBottom: '1rem', display: 'flex', gap: '1.5rem', fontSize: '0.9rem' }}>
                            <span><strong>Rows:</strong> {previewData.stats.rowCount}</span>
                            <span><strong>Avg Input:</strong> {previewData.stats.avgInputLen} chars</span>
                            <span><strong>Avg Output:</strong> {previewData.stats.avgOutputLen} chars</span>
                        </div>
                        {previewData.errors.length > 0 && (
                            <div style={{ background: '#7f1d1d', padding: '0.75rem', borderRadius: '4px', marginBottom: '1rem', fontSize: '0.85rem' }}>
                                <strong>Validation Issues:</strong>
                                {previewData.errors.map((e, i) => <div key={i}>{e}</div>)}
                            </div>
                        )}
                        <h4>Sample Data</h4>
                        {previewData.samples.map((s, i) => (
                            <pre key={i} style={{ background: 'rgba(0,0,0,0.3)', padding: '0.75rem', borderRadius: '4px', marginBottom: '0.5rem', fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
{JSON.stringify(s, null, 2)}
                            </pre>
                        ))}
                        <button onClick={() => setPreviewData(null)} style={{ marginTop: '1rem' }}>Close</button>
                    </div>
                </div>
            )}
        </div>
    );
}
