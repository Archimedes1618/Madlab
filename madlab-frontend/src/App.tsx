import { useState, useRef, useEffect, useCallback, memo } from 'react';
import CudaSetup from './components/setup/CudaSetup';
import { InstillationsPanel } from './components/InstillationsPanel';
import { TrainingPanel } from './components/TrainingPanel';
import { MonitoringPanel } from './components/MonitoringPanel';
import { ChatPanel } from './components/ChatPanel';
import { CommandPalette } from './components/CommandPalette';
import { uuid } from './utils/uuid';
import type { LogLine, TrainingMetrics } from './types';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/events';

type TabType = 'instillations' | 'training' | 'monitoring' | 'chat';

// Memoized tab button to prevent unnecessary re-renders
const TabButton = memo(function TabButton({
  tab,
  activeTab,
  onClick,
  children
}: {
  tab: TabType;
  activeTab: TabType;
  onClick: (tab: TabType) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={activeTab === tab ? 'active' : ''}
      onClick={() => onClick(tab)}
    >
      {children}
    </button>
  );
});

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('chat');
  const [isSetupMode, setIsSetupMode] = useState(window.location.hash === '#/setup');

  // Listen for hash changes to toggle setup mode
  useEffect(() => {
    const handleHashChange = () => {
      setIsSetupMode(window.location.hash === '#/setup');
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const [monitoringLogs, setLogs] = useState<LogLine[]>([]);
  const [monitoringMetrics, setMetrics] = useState<TrainingMetrics>({});
  const [_monitoringFiles, setFiles] = useState<Record<string, number>>({});
  const [wsStatus, setWsStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('disconnected');
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    (localStorage.getItem('theme') as 'dark' | 'light') || 'dark'
  );
  const [toasts, setToasts] = useState<{ id: string; type: 'success' | 'error' | 'info'; message: string }[]>([]);
  const [showPalette, setShowPalette] = useState(false);
  const [lossHistory, setLossHistory] = useState<{ step: number; loss: number }[]>([]);

  const ws = useRef<WebSocket | null>(null);
  const retryCount = useRef(0);
  const retryTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addToast = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    const id = uuid();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Theme effect
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Keyboard shortcuts: Ctrl+1/2/3/4 for tabs, Ctrl+K for palette
  useEffect(() => {
    const tabs: TabType[] = ['instillations', 'training', 'monitoring', 'chat'];
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowPalette(p => !p);
      } else if (e.ctrlKey && e.key >= '1' && e.key <= '4') {
        e.preventDefault();
        setActiveTab(tabs[parseInt(e.key) - 1]);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    const connect = () => {
      if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
        return;
      }

      console.log('App: Connecting to WebSocket...');
      ws.current = new WebSocket(WS_URL);

      ws.current.onopen = () => {
        console.log('App: WebSocket Connected');
        retryCount.current = 0;
        setWsStatus('connected');
        setLogs(prev => [...prev.slice(-100), { id: uuid(), type: 'system', payload: 'Connected to Server', timestamp: new Date().toLocaleTimeString() }]);
      };

      ws.current.onerror = (err) => {
        console.error('App: WS Error', err);
        setLogs(prev => [...prev.slice(-100), { id: uuid(), type: 'error', payload: 'Connection Error', timestamp: new Date().toLocaleTimeString() }]);
      };

      ws.current.onclose = () => {
        console.log('App: WebSocket Closed');
        setWsStatus('disconnected');
        setLogs(prev => [...prev.slice(-100), { id: uuid(), type: 'system', payload: 'Disconnected', timestamp: new Date().toLocaleTimeString() }]);

        // Reconnect with exponential backoff (max 5 retries)
        if (retryCount.current < 5) {
          const delay = Math.min(1000 * Math.pow(2, retryCount.current), 30000);
          retryCount.current++;
          setWsStatus('reconnecting');
          setLogs(prev => [...prev.slice(-100), { id: uuid(), type: 'system', payload: `Reconnecting in ${delay / 1000}s... (${retryCount.current}/5)`, timestamp: new Date().toLocaleTimeString() }]);
          retryTimeout.current = setTimeout(connect, delay);
        } else {
          setLogs(prev => [...prev.slice(-100), { id: uuid(), type: 'error', payload: 'Connection lost. Refresh page to retry.', timestamp: new Date().toLocaleTimeString() }]);
        }
      };

      ws.current.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const timestamp = new Date().toLocaleTimeString();

          if (msg.type === 'train-log') {
            if (msg.payload.loss !== undefined) {
              setMetrics(msg.payload);
              if (msg.payload.step !== undefined) {
                setLossHistory(prev => [...prev.slice(-500), { step: msg.payload.step, loss: msg.payload.loss }]);
              }
            }
            setLogs(prev => [...prev.slice(-100), { id: uuid(), type: 'log', payload: msg.payload, timestamp }]);
          } else if (msg.type === 'file-size') {
            setFiles(prev => ({ ...prev, [msg.payload.file]: msg.payload.size }));
          } else if (msg.type === 'status') {
            if (msg.payload.running && !msg.payload.stopping) {
              setLossHistory([]);  // Reset loss history when training starts
            }
            setLogs(prev => [...prev.slice(-100), { id: uuid(), type: msg.type, payload: msg.payload, timestamp }]);
          } else {
            setLogs(prev => [...prev.slice(-100), { id: uuid(), type: msg.type, payload: msg.payload, timestamp }]);
          }
        } catch (e) {
          console.error('App: WS Parse Error', e);
        }
      };
    };

    connect();

    return () => {
      if (retryTimeout.current) clearTimeout(retryTimeout.current);
      ws.current?.close();
    };
  }, []);

  // Memoized tab change handler
  const handleTabChange = useCallback((tab: TabType) => {
    setActiveTab(tab);
  }, []);

  const statusConfig = {
    connected: { color: '#10b981', glow: 'rgba(16, 185, 129, 0.5)', label: 'Connected' },
    reconnecting: { color: '#f59e0b', glow: 'rgba(245, 158, 11, 0.4)', label: 'Reconnecting...' },
    disconnected: { color: '#ef4444', glow: 'rgba(239, 68, 68, 0.4)', label: 'Disconnected' }
  }[wsStatus];

  const toastConfig = {
    success: { bg: 'linear-gradient(135deg, #059669 0%, #10b981 100%)', border: 'rgba(16, 185, 129, 0.3)' },
    error: { bg: 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)', border: 'rgba(239, 68, 68, 0.3)' },
    info: { bg: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)', border: 'rgba(59, 130, 246, 0.3)' }
  };

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';
  const commands = [
    { id: 'start', name: 'Start Training', desc: 'Begin model training', action: () => fetch(`${API_URL}/train/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ configPath: 'config/train.yaml' }) }).then(() => addToast('success', 'Training started')).catch(() => addToast('error', 'Failed to start')) },
    { id: 'stop', name: 'Stop Training', desc: 'Stop current training run', action: () => fetch(`${API_URL}/train/stop`, { method: 'POST' }).then(() => addToast('success', 'Training stopped')).catch(() => addToast('error', 'Failed to stop')) },
    { id: 'tab-instill', name: 'Switch to Instillations', desc: 'Go to instillations tab', action: () => setActiveTab('instillations') },
    { id: 'tab-train', name: 'Switch to Training', desc: 'Go to training tab', action: () => setActiveTab('training') },
    { id: 'tab-monitor', name: 'Switch to Monitoring', desc: 'Go to monitoring tab', action: () => setActiveTab('monitoring') },
    { id: 'tab-chat', name: 'Switch to Chat', desc: 'Go to chat tab', action: () => setActiveTab('chat') },
    { id: 'export', name: 'Export Bundle', desc: 'Download model artifacts', action: () => window.open(`${API_URL}/train/export`, '_blank') },
    { id: 'refresh', name: 'Refresh Datasets', desc: 'Reload dataset list', action: () => { fetch(`${API_URL}/datasets`); addToast('info', 'Datasets refreshed'); } },
    { id: 'theme', name: 'Toggle Theme', desc: 'Switch dark/light mode', action: () => setTheme(t => t === 'dark' ? 'light' : 'dark') },
    { id: 'save', name: 'Save Config', desc: 'Save current training config', action: () => addToast('info', 'Switch to Training tab to save config') },
  ];


  if (isSetupMode) {
    return <CudaSetup />;
  }

  return (
    <div className="layout">
      {showPalette && <CommandPalette commands={commands} onClose={() => setShowPalette(false)} />}
      <header>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <h1>Madlab</h1>
            <div
              title={statusConfig.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.25rem 0.625rem',
                background: 'rgba(255, 255, 255, 0.03)',
                borderRadius: '20px',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                cursor: 'help'
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: statusConfig.color,
                  boxShadow: `0 0 8px ${statusConfig.glow}, 0 0 12px ${statusConfig.glow}`,
                  animation: wsStatus === 'connected' ? 'pulse-glow 2s ease-in-out infinite' : undefined
                }}
              />
              <span style={{
                fontSize: '0.6875rem',
                fontWeight: 500,
                color: 'var(--text-muted)',
                letterSpacing: '0.02em'
              }}>
                {statusConfig.label}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <button
              onClick={() => setShowPalette(true)}
              style={{
                padding: '0.375rem 0.75rem',
                fontSize: '0.75rem',
                fontFamily: 'var(--font-mono)',
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)'
              }}
              title="Ctrl+K"
            >
              ⌘K
            </button>
            <button
              onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
              style={{
                padding: '0.375rem 0.625rem',
                fontSize: '0.8125rem',
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
                minWidth: '2.5rem'
              }}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
          </div>
        </div>
        <nav>
          <TabButton tab="instillations" activeTab={activeTab} onClick={handleTabChange}>
            Instillations
          </TabButton>
          <TabButton tab="training" activeTab={activeTab} onClick={handleTabChange}>
            Training
          </TabButton>
          <TabButton tab="monitoring" activeTab={activeTab} onClick={handleTabChange}>
            Monitoring
          </TabButton>
          <TabButton tab="chat" activeTab={activeTab} onClick={handleTabChange}>
            Chat
          </TabButton>
        </nav>
      </header>

      <main style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {activeTab === 'instillations' && <InstillationsPanel />}
        {/* TrainingPanel stays mounted to preserve timer state */}
        <div style={{ display: activeTab === 'training' ? 'contents' : 'none' }}>
          <TrainingPanel metrics={monitoringMetrics} />
        </div>
        {activeTab === 'monitoring' && (
          <MonitoringPanel
            logs={monitoringLogs}
            metrics={monitoringMetrics}
            lossHistory={lossHistory}
          />
        )}
        {activeTab === 'chat' && <ChatPanel />}
      </main>

      {/* Toast container */}
      <div style={{ position: 'fixed', bottom: '1.5rem', right: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.625rem', zIndex: 1000 }}>
        {toasts.map(t => (
          <div
            key={t.id}
            className="toast-enter"
            style={{
              background: toastConfig[t.type].bg,
              color: 'white',
              padding: '0.75rem 1rem',
              borderRadius: '10px',
              boxShadow: `0 8px 24px rgba(0,0,0,0.4), 0 0 0 1px ${toastConfig[t.type].border}`,
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              minWidth: '280px',
              maxWidth: '400px',
              backdropFilter: 'blur(8px)',
              fontSize: '0.8125rem',
              fontWeight: 500
            }}
          >
            <span style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'white',
              opacity: 0.8,
              flexShrink: 0
            }} />
            <span style={{ flex: 1 }}>{t.message}</span>
            <button
              onClick={() => removeToast(t.id)}
              style={{
                background: 'rgba(255,255,255,0.15)',
                border: 'none',
                color: 'white',
                cursor: 'pointer',
                padding: '0.25rem 0.5rem',
                fontSize: '0.875rem',
                lineHeight: 1,
                borderRadius: '4px',
                opacity: 0.8,
                transition: 'opacity 0.15s'
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
