import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  onBackendPort: (callback: (port: number) => void) => {
    ipcRenderer.on('backend-port', (_, port) => callback(port));
  },
  platform: process.platform,

  // Setup Wizard API
  checkVenvStatus: () => ipcRenderer.invoke('check-venv-status'),
  detectSystemGPU: () => ipcRenderer.invoke('detect-system-gpu'),
  startSetup: (config: any) => ipcRenderer.invoke('run-setup', config),
  onLog: (callback: (log: string) => void) => ipcRenderer.on('setup-log', (_, log) => callback(log)),
  onProgress: (callback: (step: string) => void) => ipcRenderer.on('setup-progress', (_, step) => callback(step)),
});
