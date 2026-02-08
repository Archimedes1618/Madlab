import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { uuid } from '../utils/uuid';
import type { ChatMessage } from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

interface ChatMessageWithId extends ChatMessage {
    id: string;
}

interface ChatCompletionResponse {
    choices?: Array<{
        message: ChatMessage;
    }>;
}

// Memoized message bubble component
const MessageBubble = memo(function MessageBubble({ msg }: { msg: ChatMessageWithId }) {
    const isUser = msg.role === 'user';
    const isSystem = msg.role === 'system';

    return (
        <div style={{
            alignSelf: isUser ? 'flex-end' : 'flex-start',
            maxWidth: isSystem ? '100%' : '75%',
            background: isUser
                ? 'linear-gradient(135deg, var(--primary) 0%, #6d28d9 100%)'
                : isSystem
                    ? 'rgba(124, 58, 237, 0.08)'
                    : 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)',
            padding: isSystem ? '0.625rem 1rem' : '0.875rem 1.125rem',
            borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
            border: isUser ? 'none' : '1px solid rgba(255,255,255,0.06)',
            boxShadow: isUser
                ? '0 4px 16px rgba(124, 58, 237, 0.3)'
                : '0 2px 8px rgba(0,0,0,0.2)',
            whiteSpace: 'pre-wrap',
            position: 'relative' as const,
            overflow: 'hidden'
        }}>
            {isUser && (
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: '1px',
                    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)'
                }} />
            )}
            <div style={{
                fontSize: '0.625rem',
                fontWeight: 600,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.06em',
                color: isUser ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)',
                marginBottom: '0.375rem'
            }}>
                {msg.role}
            </div>
            <div style={{
                fontSize: '0.875rem',
                lineHeight: 1.6,
                color: isUser ? 'white' : 'var(--text-primary)'
            }}>
                {msg.content}
            </div>
        </div>
    );
});

const MADLAB_SYSTEM_PROMPT = `You are MadLab Assistant, an expert AI fine-tuning coach built into MadLab - a local LLM fine-tuning studio.

## Your Role
Help users successfully fine-tune language models on their local hardware. You have deep knowledge of:
- LoRA, QLoRA, and DoRA adapter training techniques
- Hyperparameter optimization for different model sizes and hardware constraints
- Dataset preparation, formatting, and quality assessment
- GGUF quantization and model conversion
- Troubleshooting common training issues (OOM, loss spikes, overfitting)

## MadLab Context
MadLab runs locally and connects to LM Studio for inference. Users can:
- Import datasets from HuggingFace or upload JSONL files
- Configure training parameters (epochs, batch size, learning rate, etc.)
- Monitor training progress with real-time loss charts
- Convert trained models to GGUF format for local inference
- Evaluate model quality with automated metrics and LLM-based judging

## Best Practices You Should Share
**Dataset Quality:**
- Aim for diverse, high-quality instruction-response pairs
- 1,000-10,000 samples is typically sufficient for fine-tuning
- Use the "Clean" feature to deduplicate and validate data
- Balance dataset if training on specific tasks

**Hyperparameters by Model Size:**
- <1B params: batch_size=8, lr=5e-5, epochs=3
- 1-3B params: batch_size=4, lr=3e-5, epochs=2-3
- >3B params: batch_size=2, lr=2e-5, grad_accum=4-8

**Memory Optimization:**
- Enable gradient checkpointing for large models
- Use 8-bit optimizers (AdamW 8-bit) to save VRAM
- Reduce max_seq_len if hitting OOM
- Enable packing for 1.5-3x training speedup

**Training Tips:**
- Use cosine LR scheduler for smoother convergence
- Monitor validation loss - stop if it starts increasing (overfitting)
- Save checkpoints frequently (every 50-100 steps)
- Start with a "Quick Test" preset to verify setup works

## Response Style
- Be concise and practical
- Give specific numbers and settings when relevant
- If the user shares an error, diagnose it directly
- Suggest next steps proactively`;

const DEFAULT_SYSTEM_MSG: ChatMessageWithId = { id: 'system-default', role: 'system', content: MADLAB_SYSTEM_PROMPT };

export function ChatPanel() {
    // Persist chat to localStorage to survive tab switches
    const [messages, setMessages] = useState<ChatMessageWithId[]>(() => {
        try {
            const saved = localStorage.getItem('madlab_chat_history');
            if (saved) return JSON.parse(saved);
        } catch {}
        return [DEFAULT_SYSTEM_MSG];
    });
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Persist messages to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('madlab_chat_history', JSON.stringify(messages));
        } catch (e) {
            console.warn('Failed to persist chat (quota exceeded?):', e);
        }
    }, [messages]);

    const clearChat = useCallback(() => {
        setMessages([DEFAULT_SYSTEM_MSG]);
    }, []);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSend = useCallback(async () => {
        if (!input.trim() || loading) return;

        const userMsg: ChatMessageWithId = { id: uuid(), role: 'user', content: input };
        const newHistory = [...messages, userMsg];
        setMessages(newHistory);
        setInput('');
        setLoading(true);

        try {
            const res = await fetch(`${API_URL}/api/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: newHistory.map(({ role, content }) => ({ role, content }))
                })
            });

            const data: ChatCompletionResponse = await res.json();

            if (data.choices && data.choices[0]) {
                const assistMsg = data.choices[0].message;
                setMessages(prev => [...prev, { id: uuid(), ...assistMsg }]);
            } else {
                setMessages(prev => [...prev, { id: uuid(), role: 'assistant', content: 'Error: No response from model.' }]);
            }

        } catch (e) {
            const message = e instanceof Error ? e.message : 'Unknown error';
            setMessages(prev => [...prev, { id: uuid(), role: 'assistant', content: `Error: ${message}` }]);
        } finally {
            setLoading(false);
        }
    }, [input, loading, messages]);

    return (
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <h2 style={{ margin: 0 }}>Chat Playground</h2>
                <button
                    onClick={clearChat}
                    disabled={loading}
                    title="Clear conversation"
                    style={{
                        background: 'transparent',
                        border: '1px solid var(--border)',
                        color: 'var(--text-muted)',
                        padding: '0.375rem 0.625rem',
                        fontSize: '0.75rem'
                    }}
                >
                    Clear
                </button>
            </div>

            <div style={{
                flex: 1,
                overflowY: 'auto',
                marginBottom: '1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.875rem',
                padding: '0.5rem',
                background: 'rgba(0,0,0,0.15)',
                borderRadius: '10px',
                border: '1px solid rgba(255,255,255,0.03)'
            }}>
                {/* Filter out system messages from display - they're still sent to the API */}
                {messages.filter(msg => msg.role !== 'system').map(msg => (
                    <MessageBubble key={msg.id} msg={msg} />
                ))}
                {loading && (
                    <div style={{
                        alignSelf: 'flex-start',
                        padding: '0.75rem 1rem',
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: '12px',
                        border: '1px solid rgba(255,255,255,0.06)',
                        fontSize: '0.8125rem',
                        color: 'var(--text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                    }}>
                        <span style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: 'var(--primary)',
                            animation: 'pulse-glow 1s ease-in-out infinite'
                        }} />
                        Thinking...
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div style={{
                display: 'flex',
                gap: '0.5rem',
                padding: '0.75rem',
                background: 'rgba(0,0,0,0.2)',
                borderRadius: '10px',
                border: '1px solid rgba(255,255,255,0.04)'
            }}>
                <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSend()}
                    placeholder="Type a message..."
                    style={{
                        marginBottom: 0,
                        flex: 1,
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        borderRadius: '8px'
                    }}
                />
                <button
                    className="primary"
                    onClick={handleSend}
                    disabled={loading}
                    style={{ minWidth: '4.5rem' }}
                >
                    {loading ? '...' : 'Send'}
                </button>
            </div>
        </div>
    );
}
