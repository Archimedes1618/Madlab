import { useState, useEffect, useRef, useCallback } from 'react';

type Command = { id: string; name: string; desc: string; action: () => void };

interface CommandPaletteProps {
  commands: Command[];
  onClose: () => void;
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query
    ? commands.filter(c => c.name.toLowerCase().includes(query.toLowerCase()) || c.desc.toLowerCase().includes(query.toLowerCase()))
    : commands;

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setSelected(0); }, [query]);

  const run = useCallback((cmd: Command) => { cmd.action(); onClose(); }, [onClose]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && filtered[selected]) run(filtered[selected]);
  };

  const highlight = (text: string) => {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{
          background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
          color: '#fff',
          borderRadius: 3,
          padding: '0 2px'
        }}>
          {text.slice(idx, idx + query.length)}
        </mark>
        {text.slice(idx + query.length)}
      </>
    );
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        zIndex: 9999
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'linear-gradient(180deg, rgba(18, 21, 31, 0.98) 0%, rgba(15, 17, 26, 0.99) 100%)',
          borderRadius: 14,
          width: '100%',
          maxWidth: 520,
          boxShadow: '0 25px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06), 0 0 40px rgba(124, 58, 237, 0.15)',
          overflow: 'hidden',
          position: 'relative' as const
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Top gradient line */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '2px',
          background: 'linear-gradient(90deg, transparent, var(--primary), var(--secondary), transparent)'
        }} />

        {/* Search input */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            background: 'rgba(0,0,0,0.2)',
            borderRadius: 8,
            padding: '0 0.875rem',
            border: '1px solid rgba(255,255,255,0.04)'
          }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>⌘</span>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Type a command..."
              style={{
                width: '100%',
                padding: '0.75rem 0',
                border: 'none',
                background: 'transparent',
                color: 'var(--text-primary)',
                fontSize: '0.9375rem',
                outline: 'none',
                fontFamily: 'var(--font-display)'
              }}
            />
          </div>
        </div>

        {/* Commands list */}
        <div style={{ maxHeight: 320, overflowY: 'auto', padding: '0.5rem' }}>
          {filtered.length === 0 && (
            <div style={{
              padding: '2rem 1rem',
              color: 'var(--text-muted)',
              textAlign: 'center' as const,
              fontSize: '0.875rem'
            }}>
              No commands found
            </div>
          )}
          {filtered.map((cmd, i) => (
            <div
              key={cmd.id}
              onClick={() => run(cmd)}
              style={{
                padding: '0.75rem 1rem',
                cursor: 'pointer',
                background: i === selected
                  ? 'linear-gradient(135deg, rgba(124, 58, 237, 0.15) 0%, rgba(236, 72, 153, 0.08) 100%)'
                  : 'transparent',
                borderRadius: 8,
                borderLeft: i === selected ? '3px solid var(--primary)' : '3px solid transparent',
                transition: 'all 0.15s',
                marginBottom: 2
              }}
            >
              <div style={{
                fontWeight: 500,
                fontSize: '0.875rem',
                color: i === selected ? 'var(--text-primary)' : 'var(--text-secondary)'
              }}>
                {highlight(cmd.name)}
              </div>
              <div style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                marginTop: 2
              }}>
                {highlight(cmd.desc)}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '0.625rem 1rem',
          borderTop: '1px solid rgba(255,255,255,0.04)',
          background: 'rgba(0,0,0,0.15)',
          display: 'flex',
          gap: '1rem',
          fontSize: '0.6875rem',
          color: 'var(--text-muted)'
        }}>
          <span>
            <kbd style={{
              background: 'rgba(255,255,255,0.06)',
              padding: '2px 6px',
              borderRadius: 4,
              marginRight: 4,
              fontFamily: 'var(--font-mono)',
              fontSize: '0.625rem'
            }}>↑↓</kbd>
            navigate
          </span>
          <span>
            <kbd style={{
              background: 'rgba(255,255,255,0.06)',
              padding: '2px 6px',
              borderRadius: 4,
              marginRight: 4,
              fontFamily: 'var(--font-mono)',
              fontSize: '0.625rem'
            }}>↵</kbd>
            select
          </span>
          <span>
            <kbd style={{
              background: 'rgba(255,255,255,0.06)',
              padding: '2px 6px',
              borderRadius: 4,
              marginRight: 4,
              fontFamily: 'var(--font-mono)',
              fontSize: '0.625rem'
            }}>esc</kbd>
            close
          </span>
        </div>
      </div>
    </div>
  );
}
