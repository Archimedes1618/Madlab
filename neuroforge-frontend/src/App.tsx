import { useState, useRef, useEffect } from 'react';
import { InstillationsPanel } from './components/InstillationsPanel';
import { TrainingPanel } from './components/TrainingPanel';
import { MonitoringPanel } from './components/MonitoringPanel';
import { ChatPanel } from './components/ChatPanel';
import type { LogLine } from './types';

const WS_URL = 'ws://localhost:8080/events';

function App() {
  const [activeTab, setActiveTab] = useState<'instillations' | 'training' | 'monitoring' | 'chat'>('chat');
  const [monitoringLogs, setLogs] = useState<LogLine[]>([]);
  const [monitoringMetrics, setMetrics] = useState<any>({});
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
          setFiles((prev: any) => ({ ...prev, [msg.payload.file]: msg.payload.size }));
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

  return (
    <div className="layout">
      <header>
        <h1>Madlab</h1>
        <nav>
          <button
            className={activeTab === 'instillations' ? 'active' : ''}
            onClick={() => setActiveTab('instillations')}
          >
            Instillations
          </button>
          <button
            className={activeTab === 'training' ? 'active' : ''}
            onClick={() => setActiveTab('training')}
          >
            Training
          </button>
          <button
            className={activeTab === 'monitoring' ? 'active' : ''}
            onClick={() => setActiveTab('monitoring')}
          >
            Monitoring
          </button>
          <button
            className={activeTab === 'chat' ? 'active' : ''}
            onClick={() => setActiveTab('chat')}
          >
            Chat
          </button>
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
