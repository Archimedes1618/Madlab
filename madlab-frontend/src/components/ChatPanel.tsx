import { useState, useRef, useEffect, useCallback, memo } from 'react';
import type { ChatMessage } from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

interface ChatCompletionResponse {
    choices?: Array<{
        message: ChatMessage;
    }>;
}

// Memoized message bubble component
const MessageBubble = memo(function MessageBubble({ msg }: { msg: ChatMessage }) {
    return (
        <div style={{
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '80%',
            background: msg.role === 'user' ? 'var(--primary)' : 'var(--card-bg)',
            padding: '0.8rem 1.2rem',
            borderRadius: '12px',
            border: msg.role === 'user' ? 'none' : '1px solid var(--border)',
            whiteSpace: 'pre-wrap'
        }}>
            <div style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: '0.25rem' }}>{msg.role.toUpperCase()}</div>
            {msg.content}
        </div>
    );
});

export function ChatPanel() {
    const [messages, setMessages] = useState<ChatMessage[]>([
        { role: 'system', content: 'You are a helpful AI assistant connected via Madlab.' }
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSend = useCallback(async () => {
        if (!input.trim() || loading) return;

        const userMsg: ChatMessage = { role: 'user', content: input };
        const newHistory = [...messages, userMsg];
        setMessages(newHistory);
        setInput('');
        setLoading(true);

        try {
            const res = await fetch(`${API_URL}/api/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: newHistory
                })
            });

            const data: ChatCompletionResponse = await res.json();

            if (data.choices && data.choices[0]) {
                const assistMsg = data.choices[0].message;
                setMessages(prev => [...prev, assistMsg]);
            } else {
                setMessages(prev => [...prev, { role: 'assistant', content: 'Error: No response from model.' }]);
            }

        } catch (e) {
            const message = e instanceof Error ? e.message : 'Unknown error';
            setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${message}` }]);
        } finally {
            setLoading(false);
        }
    }, [input, loading, messages]);

    return (
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <h2>Chat Playground</h2>

            <div style={{
                flex: 1,
                overflowY: 'auto',
                marginBottom: '1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem'
            }}>
                {messages.map((msg, idx) => (
                    <MessageBubble key={idx} msg={msg} />
                ))}
                {loading && <div style={{ alignSelf: 'flex-start', padding: '1rem' }}>Typing...</div>}
                <div ref={messagesEndRef} />
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSend()}
                    placeholder="Type a message..."
                    style={{ marginBottom: 0 }}
                />
                <button className="primary" onClick={handleSend} disabled={loading}>Send</button>
            </div>
        </div>
    );
}
