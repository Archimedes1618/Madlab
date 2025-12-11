import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { InstillationsPanel } from './components/InstillationsPanel';
import { TrainingPanel } from './components/TrainingPanel';
import { MonitoringPanel } from './components/MonitoringPanel';
import { ChatPanel } from './components/ChatPanel';
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
  const [monitoringLogs, setLogs] = useState<LogLine[]>([]);
  const [monitoringMetrics, setMetrics] = useState<TrainingMetrics>({});
  const [monitoringFiles, setFiles] = useState<Record<string, number>>({});

  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Only connect if not already connected/connecting
    if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    console.log('App: Connecting to WebSocket...');
    ws.current = new WebSocket(WS_URL);

    ws.current.onopen = () => {
      console.log('App: WebSocket Connected');
      setLogs(prev => [...prev.slice(-100), { id: Date.now() + Math.random(), type: 'system', payload: 'Connected to Server', timestamp: new Date().toLocaleTimeString() }]);
    };

    ws.current.onerror = (err) => {
      console.error('App: WS Error', err);
      setLogs(prev => [...prev.slice(-100), { id: Date.now() + Math.random(), type: 'error', payload: 'Connection Error', timestamp: new Date().toLocaleTimeString() }]);
    };

    ws.current.onclose = () => {
      console.log('App: WebSocket Closed');
      setLogs(prev => [...prev.slice(-100), { id: Date.now() + Math.random(), type: 'system', payload: 'Disconnected', timestamp: new Date().toLocaleTimeString() }]);
    };

    ws.current.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const timestamp = new Date().toLocaleTimeString();

        if (msg.type === 'train-log') {
          if (msg.payload.loss) {
            setMetrics(msg.payload);
          }
          setLogs(prev => [...prev.slice(-100), { id: Date.now() + Math.random(), type: 'log', payload: msg.payload, timestamp }]);
        } else if (msg.type === 'file-size') {
          setFiles(prev => ({ ...prev, [msg.payload.file]: msg.payload.size }));
        } else {
          setLogs(prev => [...prev.slice(-100), { id: Date.now() + Math.random(), type: msg.type, payload: msg.payload, timestamp }]);
        }
      } catch (e) {
        console.error('App: WS Parse Error', e);
      }
    };

    return () => {
      // Cleanup on unmount? In App, this happens only on page reload.
      // We can close it, but strictly speaking keeping it open is fine for App level.
      // If we strictly close, React Strict Mode will disconnect/reconnect cleanly via the new check above.
      ws.current?.close();
    };
  }, []);

  // Memoized tab change handler
  const handleTabChange = useCallback((tab: TabType) => {
    setActiveTab(tab);
  }, []);

  return (
    <div className="layout">
      <header>
        <h1>Madlab</h1>
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
        {activeTab === 'training' && <TrainingPanel />}
        {activeTab === 'monitoring' && (
          <MonitoringPanel
            logs={monitoringLogs}
            metrics={monitoringMetrics}
            files={monitoringFiles}
          />
        )}
        {activeTab === 'chat' && <ChatPanel />}
      </main>
    </div>
  );
}

export default App;
