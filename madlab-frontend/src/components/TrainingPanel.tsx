import { useState, useEffect, useCallback } from 'react';
import { ModelBrowser } from './ModelBrowser';
import { DatasetGenerator } from './DatasetGenerator';
import type { TrainingStatus, TrainingConfig, DatasetInfo, ModelArtifact } from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

export function TrainingPanel() {
    const [status, setStatus] = useState<TrainingStatus>({ running: false });
    const [loading, setLoading] = useState(false);
    const [showModelBrowser, setShowModelBrowser] = useState(false);
    const [showGenerator, setShowGenerator] = useState(false);
    const [hfRepo, setHfRepo] = useState('');
    const [processing, setProcessing] = useState(false);
    const [split, setSplit] = useState('train');

    const fetchStatus = async () => {
        try {
            const res = await fetch(`${API_URL}/train/status`);
            const data = await res.json();
            setStatus(data);
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 2000);
        return () => clearInterval(interval);
    }, []);

    const handleStart = async () => {
        setLoading(true);
        await fetch(`${API_URL}/train/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ configPath: 'config/train.yaml' })
        });
        setLoading(false);
        fetchStatus();
    };

    const handleStop = async () => {
        await fetch(`${API_URL}/train/stop`, { method: 'POST' });
        fetchStatus();
    };

    const [artifacts, setArtifacts] = useState<ModelArtifact[]>([]);
    const fetchArtifacts = useCallback(async () => {
        try {
            const res = await fetch(`${API_URL}/train/artifacts`);
            const data = await res.json();
            setArtifacts(data);
        } catch (e) {
            console.error('Failed to fetch artifacts:', e);
        }
    }, []);

    useEffect(() => {
        fetchArtifacts();
        const interval = setInterval(fetchArtifacts, 5000);
        return () => clearInterval(interval);
    }, []);

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

    // Judge State
    const [judgeLimit, setJudgeLimit] = useState(20);
    const [judgeSharpness, setJudgeSharpness] = useState(50);

    const handleJudge = async (modelName: string, quantization: string) => {
        try {
            await fetch(`${API_URL}/train/judge`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    modelName,
                    quantization,
                    limit: judgeLimit / 100, // Convert % to fraction
                    sharpness: judgeSharpness
                })
            });
            alert('Magic Judge started! Check the Monitoring tab for progress.');
        } catch (e) {
            console.error(e);
            alert('Failed to start Magic Judge');
        }
    };

    const fetchConfig = async () => {
        try {
            const res = await fetch(`${API_URL}/train/config`);
            const data = await res.json();
            setConfigData(data);
        } catch (e) {
            console.error(e);
        }
    };

    const [datasets, setDatasets] = useState<DatasetInfo[]>([]);

    const fetchDatasets = useCallback(async () => {
        try {
            const res = await fetch(`${API_URL}/datasets`);
            const data = await res.json();
            setDatasets(data);
        } catch (e) {
            console.error('Failed to fetch datasets:', e);
        }
    }, []);

    const [modelHistory, setModelHistory] = useState<string[]>([]);
    const fetchHistory = useCallback(async () => {
        try {
            const res = await fetch(`${API_URL}/train/history`);
            const data = await res.json();
            setModelHistory(data);
        } catch (e) {
            console.error('Failed to fetch history:', e);
        }
    }, []);

    useEffect(() => {
        fetchConfig();
        fetchDatasets();
        fetchHistory();
    }, []);

    const updateConfig = useCallback((section: keyof TrainingConfig, key: string, value: string | number) => {
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

    return (
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                <div>
                    <h2>Training Control</h2>

                    {configData && (
                        <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
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
                                    <button onClick={() => setShowModelBrowser(true)}>Browse HF</button>
                                </div>
                                <datalist id="models">
                                    {modelHistory.map(m => <option key={m} value={m} />)}
                                    <option value="TinyLlama/TinyLlama-1.1B-Chat-v1.0" />
                                    <option value="mistralai/Mistral-7B-Instruct-v0.2" />
                                </datalist>
                            </label>

                            {showModelBrowser && (
                                <ModelBrowser
                                    onSelect={(id) => updateConfig('model', 'name', id)}
                                    onClose={() => setShowModelBrowser(false)}
                                />
                            )}

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                                <label>
                                    Epochs
                                    <input type="number" min="1" max="100" value={configData.train.epochs} onChange={e => updateConfig('train', 'epochs', parseInt(e.target.value) || 1)} />
                                </label>
                                <label>
                                    Batch Size
                                    <input type="number" min="1" max="64" value={configData.train.batch_size} onChange={e => updateConfig('train', 'batch_size', parseInt(e.target.value) || 1)} />
                                </label>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                                <label>
                                    Learning Rate
                                    <input type="number" min="0.000001" max="0.01" step="0.00001" value={configData.train.lr} onChange={e => updateConfig('train', 'lr', parseFloat(e.target.value) || 0.00005)} />
                                </label>
                                <label>
                                    Max Seq Len
                                    <input type="number" min="64" max="4096" value={configData.train.max_seq_len} onChange={e => updateConfig('train', 'max_seq_len', parseInt(e.target.value) || 512)} />
                                </label>
                            </div>
                            <label>
                                Device
                                <select value={configData.runtime.device} onChange={e => updateConfig('runtime', 'device', e.target.value)}>
                                    <option value="cpu">CPU</option>
                                    <option value="cuda">CUDA (GPU)</option>
                                </select>
                            </label>
                            <label>
                                Workers
                                <input type="number" min="0" max="8" value={configData.runtime.workers || 0} onChange={e => updateConfig('runtime', 'workers', parseInt(e.target.value) || 0)} />
                            </label>

                            <button onClick={saveConfig} disabled={saving || status.running}>
                                {saving ? 'Saving...' : 'Save Configuration'}
                            </button>
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '1rem' }}>
                        {!status.running ? (
                            <button className="primary" onClick={handleStart} disabled={loading}>
                                {loading ? 'Starting...' : 'Start Training'}
                            </button>
                        ) : (
                            <button onClick={handleStop} style={{ background: 'var(--danger)', color: 'white', border: 'none' }}>
                                Stop Training
                            </button>
                        )}

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{
                                width: 12, height: 12, borderRadius: '50%',
                                background: status.running ? 'var(--success)' : '#64748b'
                            }} />
                            <span>{status.running ? `Running (PID: ${status.pid})` : 'Idle'}</span>
                        </div>
                    </div>
                </div>

                <div>
                    <h2>Dataset Management</h2>
                    <div style={{ marginBottom: '1rem', background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                            <input type="file" id="datasetUpload" style={{ display: 'none' }} onChange={async (e) => {
                                if (e.target.files && e.target.files[0]) {
                                    const formData = new FormData();
                                    formData.append('file', e.target.files[0]);
                                    await fetch(`${API_URL}/datasets/upload`, { method: 'POST', body: formData });
                                    fetchDatasets();
                                }
                            }} />
                            <label htmlFor="datasetUpload" className="button" style={{ cursor: 'pointer', background: '#3b82f6', padding: '0.5rem 1rem', borderRadius: '4px', color: 'white' }}>
                                Upload .jsonl
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
                                    fetchDatasets();
                                } catch (e) { alert(e); }
                                finally { setProcessing(false); }
                            }} disabled={processing || !hfRepo} style={{ background: '#ec4899', color: 'white', marginLeft: '0.5rem' }}>
                                🪄 Magic Import
                            </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                            {datasets.map(d => (
                                <div key={d.name} style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '0.5rem', borderRadius: '4px',
                                    background: d.selected ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                                    border: d.selected ? '1px solid #3b82f6' : '1px solid transparent'
                                }}>
                                    <div>
                                        <div style={{ fontWeight: 'bold' }}>{d.name}</div>
                                        <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{(d.size / 1024).toFixed(1)} KB</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
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
                                                fetchConfig(); // Update config view
                                            }}>Select</button>
                                        )}
                                        {d.selected && <span style={{ color: '#3b82f6', fontSize: '0.8rem' }}>Active</span>}
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

                    <h2>GGUF Automation</h2>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                        <button onClick={() => convertModel('f16')}>Convert f16 (Base)</button>
                        <button onClick={() => convertModel('q8_0')}>Convert Q8_0 (Quantized)</button>
                    </div>

                    <h3>Artifacts</h3>
                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                        {artifacts.map(f => (
                            <div key={f.name} style={{ background: 'rgba(255,255,255,0.05)', padding: '0.5rem', borderRadius: '4px', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>{f.name}</span>
                                    {f.name.endsWith('.gguf') && (
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <button onClick={() => evaluateModel(f.name.replace(`-${f.name.includes('f16') ? 'f16' : 'q8_0'}.gguf`, ''), f.name.includes('f16') ? 'f16' : 'q8_0')}>
                                                Eval (Static)
                                            </button>
                                            <button
                                                onClick={() => handleJudge(f.name.replace(`-${f.name.includes('f16') ? 'f16' : 'q8_0'}.gguf`, ''), f.name.includes('f16') ? 'f16' : 'q8_0')}
                                                style={{ background: 'linear-gradient(45deg, #6366f1, #a855f7)' }}
                                            >
                                                🪄 Magic Judge
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {artifacts.length === 0 && <span style={{ color: '#64748b' }}>No artifacts found</span>}
                    </div>
                </div>
            </div>
        </div>
    );
}
