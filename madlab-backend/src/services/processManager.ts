import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { broadcast } from '../server';
import { CONFIG, getPythonPath } from '../config';
import type { TrainingMetrics } from '../types';

let runningProcess: ChildProcess | null = null;

export function startTraining(configPath: string): void {
    if (runningProcess) {
        throw new Error('Training already in progress');
    }

    const scriptPath = path.join(CONFIG.TRAINER_DIR, 'train.py');
    const absConfigPath = path.resolve(CONFIG.TRAINER_DIR, configPath);
    const pythonExec = getPythonPath();

    console.log(`Starting training with config: ${absConfigPath}`);
    console.log(`Using Python: ${pythonExec}`);

    runningProcess = spawn(pythonExec, [scriptPath, '--config', absConfigPath], {
        cwd: CONFIG.TRAINER_DIR
    });

    broadcast({ type: 'status', payload: { running: true, pid: runningProcess.pid } });

    runningProcess.stdout?.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach((line: string) => {
            try {
                const obj = JSON.parse(line) as TrainingMetrics | { message?: string; error?: string };
                broadcast({ type: 'train-log', payload: obj });
            } catch {
                // Not JSON, just raw text
                console.log('[Trainer]', line);
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
        broadcast({ type: 'status', payload: { running: false, code: code ?? undefined } });
    });
}

export function stopTraining(): void {
    if (runningProcess) {
        runningProcess.kill();
        runningProcess = null;
        broadcast({ type: 'status', payload: { running: false, killed: true } });
    }
}

export function getStatus(): { running: boolean; pid?: number } {
    return {
        running: !!runningProcess,
        pid: runningProcess?.pid
    };
}
