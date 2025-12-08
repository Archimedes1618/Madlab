import { useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

export function DatasetGenerator({ onDatasetGenerated }: { onDatasetGenerated: () => void }) {
    const [step, setStep] = useState(1);
    const [seedInput, setSeedInput] = useState('');
    const [seedOutput, setSeedOutput] = useState('');
    const [count, setCount] = useState(10);
    const [generating, setGenerating] = useState(false);
    const [result, setResult] = useState<any>(null);

    const handleGenerate = async () => {
        setGenerating(true);
        try {
            const res = await fetch(`${API_URL}/datasets/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ seedInput, seedOutput, count })
            });
            const data = await res.json();
            if (data.filename) {
                setResult(data);
                setStep(3);
                onDatasetGenerated();
            }
        } catch (e) {
            console.error(e);
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px', border: '1px solid #334155' }}>
            <h3>✨ Synthetic Dataset Generator</h3>

            {step === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div>
                        <label>Seed Input (User Prompt)</label>
                        <textarea
                            value={seedInput}
                            onChange={e => setSeedInput(e.target.value)}
                            rows={3}
                            placeholder="e.g. How do I install Python?"
                            style={{ width: '100%', background: '#0f172a', color: 'white', border: '1px solid #475569', borderRadius: '4px', padding: '0.5rem' }}
                        />
                    </div>
                    <div>
                        <label>Seed Output (Ideal Response)</label>
                        <textarea
                            value={seedOutput}
                            onChange={e => setSeedOutput(e.target.value)}
                            rows={3}
                            placeholder="e.g. You can download it from python.org..."
                            style={{ width: '100%', background: '#0f172a', color: 'white', border: '1px solid #475569', borderRadius: '4px', padding: '0.5rem' }}
                        />
                    </div>
                    <div>
                        <label>Variations Count: {count}</label>
                        <input
                            type="range" min="5" max="50" value={count}
                            onChange={e => setCount(parseInt(e.target.value))}
                            style={{ width: '100%' }}
                        />
                    </div>
                    <button onClick={handleGenerate} disabled={generating || !seedInput || !seedOutput} className="primary">
                        {generating ? 'Generating via Local LLM...' : 'Generate Variations'}
                    </button>
                </div>
            )}

            {step === 3 && result && (
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🎉</div>
                    <p>Success! Generated {result.count} samples.</p>
                    <p>Saved as: <code>{result.filename}</code></p>
                    <button onClick={() => { setStep(1); setSeedInput(''); setSeedOutput(''); }} style={{ marginTop: '1rem' }}>
                        Create Another
                    </button>
                </div>
            )}
        </div>
    );
}
