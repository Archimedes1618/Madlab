import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { spawn, ChildProcess, execFile } from 'child_process';
import * as path from 'path';
import * as net from 'net';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
const isDev = !app.isPackaged;

async function findFreePort(start = 8080): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(start, () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on('error', () => resolve(findFreePort(start + 1)));
  });
}

async function startBackend(port: number): Promise<void> {
  // In dev: run from madlab-backend/dist/server.js
  // In packaged: extraResources copies dist/* to resources/backend/, so server.js is directly there
  const backendPath = isDev
    ? path.join(__dirname, '../../madlab-backend')
    : path.join(process.resourcesPath, 'backend');

  const serverScript = isDev ? 'dist/server.js' : 'server.js';

  backendProcess = spawn('node', [serverScript], {
    cwd: backendPath,
    env: { ...process.env, PORT: String(port) },
    stdio: 'pipe',
  });

  let stderrOutput = '';

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Backend timeout. stderr: ${stderrOutput || 'none'}`));
    }, 10000);

    backendProcess!.stdout?.on('data', (data) => {
      if (data.toString().includes('listening') || data.toString().includes('started')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    backendProcess!.stderr?.on('data', (data) => {
      stderrOutput += data.toString();
    });

    backendProcess!.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    backendProcess!.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Backend exited with code ${code}. stderr: ${stderrOutput || 'none'}`));
      }
    });
  });
}

function createWindow(backendPort: number, needsSetup: boolean) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const query = needsSetup ? '#/setup' : '';

  if (isDev) {
    mainWindow.loadURL(`http://localhost:5173${query}`);
    mainWindow.webContents.openDevTools();
  } else {
    // Handling hash in file protocol can be tricky, usually query params are ignored. 
    // Hash is safer.
    mainWindow.loadURL(`file://${path.join(__dirname, '../dist/index.html')}${query}`);
  }

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.send('backend-port', backendPort);
  });
}

app.whenReady().then(async () => {
  const port = await findFreePort();
  try {
    await startBackend(port);

    // Check if Setup is needed
    // We can pass a query param to the window
    const venvExists = fs.existsSync(getVenvPythonPath());
    createWindow(port, !venvExists);

  } catch (e) {
    console.error('Backend failed to start:', e);
    dialog.showErrorBox('Backend Error', `Failed to start backend server:\n${e instanceof Error ? e.message : e}`);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  backendProcess?.kill();
  if (process.platform !== 'darwin') app.quit();
});

// --- Setup Wizard Logic ---

const getTrainerPath = () => {
  return isDev
    ? path.join(__dirname, '../../madlab-backend/trainer')
    : path.join(process.resourcesPath, 'trainer');
};

/**
 * Resolves the Python executable path within the virtual environment
 * supporting both Windows and Unix-based systems.
 */
const getVenvPythonPath = (): string => {
  const trainerPath = getTrainerPath();

  if (process.platform === 'win32') {
    return path.join(trainerPath, 'venv', 'Scripts', 'python.exe');
  } else {
    // Standard path for macOS and Linux
    return path.join(trainerPath, 'venv', 'bin', 'python');
  }
};

// IPC: Check if Venv exists
ipcMain.handle('check-venv-status', async () => {
  const pythonPath = getVenvPythonPath();
  // Returns true if the specific venv python executable is found
  return fs.existsSync(pythonPath);
});

// IPC: Detect GPU
ipcMain.handle('detect-system-gpu', async () => {
  return new Promise((resolve) => {
    execFile('nvidia-smi', ['--query-gpu=name,driver_version,compute_cap', '--format=csv,noheader'], (error, stdout) => {
      if (error) {
        console.warn('GPU Detection failed:', error.message);
        resolve({ detected: false });
        return;
      }
      try {
        // Output format: "NVIDIA GeForce RTX 3090, 536.23, 8.6"
        const parts = stdout.trim().split(',').map(s => s.trim());
        if (parts.length >= 2) {
          const name = parts[0];
          const driverVersion = parts[1];
          const maxCuda = parseFloat(driverVersion) >= 520 ? '12.x' : '11.x'; // Simplified

          resolve({
            detected: true,
            name,
            maxCuda: maxCuda, // This is an approximation
            recommended: parseFloat(driverVersion) >= 525 ? '12.6' : '12.4'
          });
        } else {
          resolve({ detected: false });
        }
      } catch (e) {
        resolve({ detected: false });
      }
    });
  });
});

// IPC: Run Setup
ipcMain.handle('run-setup', async (event, config: { cudaVersion: string, isCpuMode: boolean }) => {
  const trainerPath = getTrainerPath();
  const venvPath = path.join(trainerPath, 'venv');
  const pythonExe = getVenvPythonPath();
  const setupScript = path.join(trainerPath, 'electron_setup.py');

  const sender = event.sender;
  const sendLog = (msg: string) => sender.send('setup-log', msg);
  const sendProgress = (step: string) => sender.send('setup-progress', step);

  try {
    // 1. Create Venv if missing
    if (!fs.existsSync(pythonExe)) {
      sendProgress('Creating virtual environment...');
      sendLog('Creating venv at ' + venvPath);
      await new Promise<void>((resolve, reject) => {
        // Use system python to create venv
        spawn('python', ['-m', 'venv', venvPath], { cwd: trainerPath })
          .on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error('Failed to create venv'));
          });
      });
    }

    // 2. Run Setup Script
    sendProgress('Installing dependencies...');
    sendLog(`Running setup script: ${setupScript}`);

    const args = config.isCpuMode
      ? ['--cpu-only']
      : ['--cuda', config.cudaVersion];

    const child = spawn(pythonExe, [setupScript, ...args], {
      cwd: trainerPath,
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    child.stdout.on('data', (data) => {
      const line = data.toString().trim();
      if (line) sendLog(line);
    });

    child.stderr.on('data', (data) => {
      const line = data.toString().trim();
      if (line) sendLog(`[STDERR] ${line}`);
    });

    await new Promise<void>((resolve, reject) => {
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Setup script exited with code ${code}`));
      });
    });

    sendProgress('Setup complete!');
    return true;

  } catch (e) {
    sendLog(`Error: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
});

app.on('before-quit', () => backendProcess?.kill());
