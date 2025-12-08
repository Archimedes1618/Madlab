import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { broadcast } from '../server';

let runningProcess: ChildProcess | null = null;

const TRAINER_DIR = path.join(__dirname, '../../trainer');
// TODO: Detect python path or use a configured one. For now assume 'venv/bin/python' or just 'python' if venv triggered
// In Windows, if venv is used, it might be Scripts/python.
// For this MVP, we will try to use the python from the active environment or a specific path.
// Let's assume the user has a 'venv' in madlab-backend/trainer/venv or similar, or just global python.
// We'll trust the command line args passed or default to 'python'.

export function startTraining(configPath: string) {
    if (runningProcess) {
        throw new Error('Training already in progress');
    }

    const scriptPath = path.join(TRAINER_DIR, 'train.py');
    const absConfigPath = path.resolve(TRAINER_DIR, configPath);

    console.log(`Starting training with config: ${absConfigPath}`);

    // Detect venv
    let pythonExec = 'python';
    const venvPythonWin = path.join(TRAINER_DIR, 'venv', 'Scripts', 'python.exe');
    const venvPythonUnix = path.join(TRAINER_DIR, 'venv', 'bin', 'python');

    // Simple sync check (fs.existsSync is available in node 'fs', importing pure 'fs' as well or using promises)
    // transforming to async startTraining? No, keep it sync or use fs-extra? 
    // We imported fs/promises. Let's use fs.existsSync from 'fs' if we can change import, 
    // or just assume windows for this user since we know OS is windows.
    // The user_information says OS is windows.
    // Let's try the Windows path first.

    // We need 'fs' for existsSync or just await access.
    // But startTraining is exported as non-async in previous code?
    // Let's make it async or use a "try/catch" with fs/promises access? 
    // Actually, spawn is sync. We should determine path before.

    // HACK: For this environment (Windows), force venv/Scripts/python.exe
    pythonExec = venvPythonWin;
    // We can add a fallback if we really want, but let's stick to this for now to ensure we use the venv.

    console.log(`Using Python: ${pythonExec}`);

    runningProcess = spawn(pythonExec, [scriptPath, '--config', absConfigPath], {
        cwd: TRAINER_DIR
    });

    broadcast({ type: 'status', payload: { running: true, pid: runningProcess.pid } });

    runningProcess.stdout?.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach((line: string) => {
            try {
                // If the python script prints JSON lines
                // Replace single quotes with double quotes if needed, or just parse
                const obj = JSON.parse(line);
                broadcast({ type: 'train-log', payload: obj });
            } catch (e) {
                // Not JSON, just raw text
                console.log('[Trainer]', line);
                // broadcast({ type: 'train-log', payload: { raw: line } });
            }
        });
    });

    runningProcess.stderr?.on('data', (data) => {
        const msg = data.toString();
        console.error('[Trainer Error]', msg);
        broadcast({ type: 'train-log', payload: { stderr: msg } });
    });

    runningProcess.on('error', (err) => {
        console.error('[Trainer Process Error]', err);
        broadcast({ type: 'train-log', payload: { error: err.message } });
        runningProcess = null;
    });

    runningProcess.on('close', (code) => {
        console.log(`Training process exited with code ${code}`);
        runningProcess = null;
        broadcast({ type: 'status', payload: { running: false, code } });
    });
}

export function stopTraining() {
    if (runningProcess) {
        runningProcess.kill();
        runningProcess = null;
        broadcast({ type: 'status', payload: { running: false, killed: true } });
    }
}

export function getStatus() {
    return {
        running: !!runningProcess,
        pid: runningProcess?.pid
    };
}
