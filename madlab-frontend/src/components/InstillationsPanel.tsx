import { useEffect, useState } from 'react';
import { useEscapeKey } from '../hooks';

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
    const [error, setError] = useState<string | null>(null);
    const [editingItem, setEditingItem] = useState<Instillation | null>(null);

    useEffect(() => {
        fetchItems();
    }, []);

    // Clear error after 5 seconds
    useEffect(() => {
        if (error) {
            const timer = setTimeout(() => setError(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [error]);

    useEscapeKey(!!editingItem, () => setEditingItem(null));

    const fetchItems = async () => {
        try {
            const res = await fetch(`${API_URL}/instillations`);
            if (!res.ok) throw new Error('Failed to fetch rules');
            const data = await res.json();
            setItems(data.pairs || []);
        } catch (e) {
            setError('Failed to load rules. Please check your connection.');
            console.error(e);
        }
    };

    const handleCreate = async () => {
        if (!newTrigger || !newResponse) {
            setError('Trigger and response are required.');
            return;
        }
        try {
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
            const res = await fetch(`${API_URL}/instillations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error('Failed to create rule');
            setNewTrigger('');
            setNewResponse('');
            fetchItems();
        } catch (e) {
            setError('Failed to create rule. Please try again.');
            console.error(e);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            const res = await fetch(`${API_URL}/instillations/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete rule');
            fetchItems();
        } catch (e) {
            setError('Failed to delete rule. Please try again.');
            console.error(e);
        }
    };

    const handleToggle = async (item: Instillation) => {
        try {
            await fetch(`${API_URL}/instillations/${item.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: !item.enabled })
            });
            fetchItems();
        } catch (e) {
            setError('Failed to toggle rule.');
            console.error(e);
        }
    };

    const handleEdit = async () => {
        if (!editingItem) return;
        try {
            await fetch(`${API_URL}/instillations/${editingItem.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editingItem)
            });
            setEditingItem(null);
            fetchItems();
        } catch (e) {
            setError('Failed to update rule.');
            console.error(e);
        }
    };

    const handleTest = async () => {
        try {
            const res = await fetch(`${API_URL}/instillations/resolve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: testInput })
            });
            if (!res.ok) throw new Error('Failed to test resolver');
            const data = await res.json();
            setTestResult(data.response || 'No match');
        } catch (e) {
            setError('Failed to test resolver. Please try again.');
            console.error(e);
        }
    };

    return (
        <div className="panel">
            <h2>Instillations</h2>

            {error && (
                <div style={{
                    position: 'fixed',
                    top: '4rem',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 999,
                    minWidth: '300px',
                    maxWidth: '500px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    background: '#7f1d1d',
                    color: '#fecaca',
                    padding: '0.75rem 1rem',
                    borderRadius: '6px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}>
                    <span>{error}</span>
                    <button
                        onClick={() => setError(null)}
                        aria-label="Dismiss error"
                        style={{ background: 'transparent', border: 'none', color: '#fecaca', cursor: 'pointer', fontSize: '1.2rem' }}
                    >
                        &times;
                    </button>
                </div>
            )}

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

            <h3>Rules</h3>
            <table>
                <thead>
                    <tr>
                        <th>On</th>
                        <th>Trigger</th>
                        <th>Type</th>
                        <th>Response</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map(item => (
                        <tr key={item.id} style={{ opacity: item.enabled ? 1 : 0.5 }}>
                            <td>
                                <button onClick={() => handleToggle(item)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1rem' }}>
                                    {item.enabled ? '✓' : '○'}
                                </button>
                            </td>
                            <td>{item.trigger}</td>
                            <td>{item.match.type}</td>
                            <td title={item.response}>
                                {item.response.length > 50 ? item.response.substring(0, 50) + '...' : item.response}
                            </td>
                            <td>
                                <button onClick={() => setEditingItem(item)} style={{ marginRight: '0.5rem', padding: '0.25rem 0.5rem' }}>Edit</button>
                                <button onClick={() => handleDelete(item.id)} style={{ background: 'var(--danger)', border: 'none', color: 'white', padding: '0.25rem 0.5rem' }}>Delete</button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {editingItem && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div style={{ background: '#1e293b', padding: '2rem', borderRadius: '8px', width: '400px' }}>
                        <h3>Edit Rule</h3>
                        <label>Trigger
                            <input value={editingItem.trigger} onChange={e => setEditingItem({...editingItem, trigger: e.target.value})} />
                        </label>
                        <label>Match Type
                            <select value={editingItem.match.type} onChange={e => setEditingItem({...editingItem, match: {...editingItem.match, type: e.target.value as 'exact' | 'regex'}})}>
                                <option value="exact">Exact</option>
                                <option value="regex">Regex</option>
                            </select>
                        </label>
                        <label>Response
                            <textarea value={editingItem.response} onChange={e => setEditingItem({...editingItem, response: e.target.value})} rows={4} />
                        </label>
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                            <button onClick={handleEdit}>Save</button>
                            <button onClick={() => setEditingItem(null)}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
