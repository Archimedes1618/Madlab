import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

interface Model {
    id: string; // HF Repo ID
    likes: number;
    downloads: number;
    tags: string[];
    pipeline_tag: string;
}

interface Props {
    onSelect: (modelId: string) => void;
    onClose: () => void;
}

export function ModelBrowser({ onSelect, onClose }: Props) {
    const [query, setQuery] = useState('');
    const [models, setModels] = useState<Model[]>([]);
    const [loading, setLoading] = useState(false);

    // Initial load - popular models
    useEffect(() => {
        searchModels('llama'); // default search to populate list
    }, []);

    // Escape key to close modal
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [onClose]);

    const searchModels = async (q: string) => {
        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/models/search?q=${encodeURIComponent(q)}&limit=10`);
            const data = await res.json();
            if (Array.isArray(data)) {
                setModels(data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="model-browser-title"
            style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center',
                zIndex: 1000
            }}
        >
            <div style={{
                background: '#1e293b', width: '800px', maxHeight: '80vh',
                borderRadius: '8px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem',
                border: '1px solid #334155'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 id="model-browser-title">Hugging Face Model Browser</h2>
                    <button onClick={onClose} aria-label="Close dialog" style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.5rem' }}>&times;</button>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && searchModels(query)}
                        placeholder="Search models (e.g. 'mistral', 'tinyllama')..."
                        style={{ flex: 1, padding: '0.5rem', borderRadius: '4px', border: '1px solid #475569', background: '#0f172a', color: 'white' }}
                    />
                    <button onClick={() => searchModels(query)} className="primary">Search</button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gap: '0.5rem' }}>
                    {loading && <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>Searching Hugging Face...</div>}

                    {!loading && models.map(m => (
                        <div key={m.id} style={{
                            background: '#0f172a', padding: '1rem', borderRadius: '6px',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            border: '1px solid #334155'
                        }}>
                            <div>
                                <div style={{ fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '0.25rem' }}>{m.id}</div>
                                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem', color: '#94a3b8' }}>
                                    <span>❤️ {m.likes}</span>
                                    <span>⬇️ {m.downloads}</span>
                                    <span style={{ background: '#334155', padding: '0 0.25rem', borderRadius: '4px' }}>{m.pipeline_tag}</span>
                                </div>
                            </div>
                            <button onClick={() => { onSelect(m.id); onClose(); }} style={{ padding: '0.5rem 1rem' }}>
                                Select
                            </button>
                        </div>
                    ))}
                    {!loading && models.length === 0 && <div style={{ textAlign: 'center', color: '#64748b' }}>No models found</div>}
                </div>
            </div>
        </div>
    );
}
