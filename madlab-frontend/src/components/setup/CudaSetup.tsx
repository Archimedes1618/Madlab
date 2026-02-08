import React, { useState, useEffect, useRef } from 'react';

interface GPUDetectionResult {
    detected: boolean;
    name?: string;
    maxCuda?: string;
    recommended?: string;
}

const CUDA_VERSIONS = ['11.8', '12.1', '12.4', '12.6', '12.8', '13.0'];

const CudaSetup: React.FC = () => {
    const [step, setStep] = useState<'detection' | 'selection' | 'installing' | 'error'>('detection');
    const [gpuInfo, setGpuInfo] = useState<GPUDetectionResult | null>(null);
    const [selectedCuda, setSelectedCuda] = useState<string>('12.1');
    const [useCpu, setUseCpu] = useState<boolean>(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [statusText, setStatusText] = useState<string>('');
    const logsEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        detectGPU();
    }, []);

    useEffect(() => {
        // Auto-scroll logs
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    // Setup listeners
    useEffect(() => {
        // @ts-ignore
        const removeLog = window.electronAPI.onLog((log: string) => {
            setLogs(prev => [...prev, log]);
        });
        // @ts-ignore
        const removeProgress = window.electronAPI.onProgress((status: string) => {
            setStatusText(status);
        });
        return () => {
            // Cleanup if possible
        };
    }, []);

    const detectGPU = async () => {
        setStep('detection');
        try {
            // @ts-ignore
            const result = await window.electronAPI.detectSystemGPU();
            setGpuInfo(result);
            if (result.detected && result.recommended) {
                setSelectedCuda(result.recommended);
            }
            if (!result.detected) {
                setUseCpu(true);
            }
            setStep('selection');
        } catch (e) {
            console.error(e);
            setStep('selection');
        }
    };

    const handleInstall = async () => {
        setStep('installing');
        setLogs([]);
        try {
            // @ts-ignore
            await window.electronAPI.startSetup({
                cudaVersion: selectedCuda,
                isCpuMode: useCpu
            });
            // Success
            setStatusText('Setup Complete! Launching...');
            setTimeout(() => {
                // Remove the hash to trigger Main App route
                window.location.hash = '';
            }, 2000);
        } catch (e) {
            console.error(e);
            setStep('error');
            setLogs(prev => [...prev, `Error: ${e}`]);
        }
    };

    return (
        <div style={{ padding: '40px', maxWidth: '800px', margin: '0 auto', fontFamily: 'Outfit', color: '#e0e0e0', backgroundColor: '#1e1e1e', height: '100vh', boxSizing: 'border-box' }}>
            <h1 style={{ textAlign: 'center', marginBottom: '40px' }}>MadLab Setup Wizard</h1>

            {step === 'detection' && (
                <div style={{ textAlign: 'center' }}>
                    <p>Detecting System Hardware...</p>
                    <div className="loader">Loading...</div>
                </div>
            )}

            {step === 'selection' && (
                <div style={{ background: '#2d2d2d', padding: '30px', borderRadius: '8px' }}>
                    <h2>Environment Configuration</h2>

                    {gpuInfo?.detected ? (
                        <div style={{ marginBottom: '20px', padding: '10px', background: '#383838', borderRadius: '4px' }}>
                            <strong>GPU Detected:</strong> {gpuInfo.name} <br />
                            <small>Driver: {gpuInfo.name} | Recommended CUDA: {gpuInfo.recommended}</small>
                        </div>
                    ) : (
                        <div style={{ marginBottom: '20px', color: '#ffcc00' }}>
                            ⚠️ No NVIDIA GPU detected. CPU mode recommended.
                        </div>
                    )}

                    <div style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={useCpu}
                                onChange={(e) => setUseCpu(e.target.checked)}
                                style={{ marginRight: '10px' }}
                            />
                            Force CPU-only Mode
                        </label>
                    </div>

                    {!useCpu && (
                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', marginBottom: '10px' }}>Select CUDA Version:</label>
                            <select
                                value={selectedCuda}
                                onChange={(e) => setSelectedCuda(e.target.value)}
                                style={{ width: '100%', padding: '10px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px' }}
                            >
                                {CUDA_VERSIONS.map(v => (
                                    <option key={v} value={v}>CUDA {v}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <button
                        onClick={handleInstall}
                        style={{ width: '100%', padding: '15px', background: '#007acc', color: 'white', border: 'none', borderRadius: '4px', fontSize: '1.1em', cursor: 'pointer' }}
                    >
                        Install Environment
                    </button>

                    <p style={{ fontSize: '0.8em', color: '#aaa', marginTop: '20px', textAlign: 'center' }}>
                        This process will download PyTorch and dependencies (~5GB) and may take a while.
                    </p>
                </div>
            )}

            {(step === 'installing' || step === 'error') && (
                <div style={{ background: '#2d2d2d', padding: '30px', borderRadius: '8px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 150px)' }}>
                    <h2>
                        {step === 'error' ? 'Installation Failed' : 'Installing Dependencies...'}
                    </h2>
                    <p style={{ color: '#007acc', fontWeight: 'bold' }}>{statusText}</p>

                    <div style={{
                        flex: 1,
                        background: '#111',
                        padding: '15px',
                        overflowY: 'auto',
                        fontFamily: 'JetBrains Mono',
                        fontSize: '0.9em',
                        borderRadius: '4px',
                        border: step === 'error' ? '1px solid red' : '1px solid #444'
                    }}>
                        {logs.map((log, i) => (
                            <div key={i} style={{ marginBottom: '2px', whiteSpace: 'pre-wrap', color: '#bbb' }}>{log}</div>
                        ))}
                        <div ref={logsEndRef} />
                    </div>

                    {step === 'error' && (
                        <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
                            <button
                                onClick={() => setStep('selection')}
                                style={{ flex: 1, padding: '10px', background: '#555', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                            >
                                Back to Settings
                            </button>
                            <button
                                onClick={handleInstall}
                                style={{ flex: 1, padding: '10px', background: '#007acc', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                            >
                                Retry
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default CudaSetup;
