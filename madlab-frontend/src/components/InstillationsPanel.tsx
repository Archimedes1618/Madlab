import { useEffect, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

interface Instillation {
    id: string;
    trigger: string;
    match: {
        type: 'exact' | 'regex' | 'semantic';
        caseInsensitive?: boolean;
        normalizeWhitespace?: boolean;
    };
    response: string;
    enabled: boolean;
}

export function InstillationsPanel() {
    const [items, setItems] = useState<Instillation[]>([]);
    const [newTrigger, setNewTrigger] = useState('');
    const [newResponse, setNewResponse] = useState('');
    const [matchType, setMatchType] = useState<'exact' | 'regex'>('exact');
    const [testInput, setTestInput] = useState('');
    const [testResult, setTestResult] = useState<string | null>(null);

    useEffect(() => {
        fetchItems();
    }, []);

    const fetchItems = async () => {
        const res = await fetch(`${API_URL}/instillations`);
        const data = await res.json();
        setItems(data.pairs);
    };

    const handleCreate = async () => {
        if (!newTrigger || !newResponse) return;
        const payload = {
            trigger: newTrigger,
            response: newResponse,
            match: {
                type: matchType,
                caseInsensitive: true,
                normalizeWhitespace: true
            },
            enabled: true
        };
        await fetch(`${API_URL}/instillations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        setNewTrigger('');
        setNewResponse('');
        fetchItems();
    };

    const handleDelete = async (id: string) => {
        await fetch(`${API_URL}/instillations/${id}`, { method: 'DELETE' });
        fetchItems();
    };

    const handleTest = async () => {
        const res = await fetch(`${API_URL}/instillations/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: testInput })
        });
        const data = await res.json();
        setTestResult(data.response || 'No match');
    };

    return (
        <div className="panel">
            <h2>Instillations</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                    <h3>Add New Rule</h3>
                    <input
                        placeholder="Trigger phrase"
                        value={newTrigger}
                        onChange={e => setNewTrigger(e.target.value)}
                    />
                    <select value={matchType} onChange={e => setMatchType(e.target.value as any)}>
                        <option value="exact">Exact Match</option>
                        <option value="regex">Regex</option>
                    </select>
                    <textarea
                        placeholder="Response"
                        value={newResponse}
                        onChange={e => setNewResponse(e.target.value)}
                        rows={3}
                    />
                    <button className="primary" onClick={handleCreate}>Add Rule</button>
                </div>
                <div>
                    <h3>Test Resolver</h3>
                    <input
                        placeholder="Type input..."
                        value={testInput}
                        onChange={e => setTestInput(e.target.value)}
                    />
                    <button onClick={handleTest}>Resolve</button>
                    {testResult && (
                        <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: '#334155', borderRadius: '4px' }}>
                            <strong>Result:</strong> {testResult}
                        </div>
                    )}
                </div>
            </div>

            <h3>Active Rules</h3>
            <table>
                <thead>
                    <tr>
                        <th>Trigger</th>
                        <th>Type</th>
                        <th>Response</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map(item => (
                        <tr key={item.id}>
                            <td>{item.trigger}</td>
                            <td>{item.match.type}</td>
                            <td title={item.response}>
                                {item.response.length > 50 ? item.response.substring(0, 50) + '...' : item.response}
                            </td>
                            <td>
                                <button
                                    onClick={() => handleDelete(item.id)}
                                    style={{ background: 'var(--danger)', border: 'none', color: 'white', padding: '0.25rem 0.5rem' }}
                                >
                                    Delete
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
