import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs, { promises as fsPromises } from 'fs';
import { broadcast } from '../server';
import { CONFIG, getPythonPath } from '../config';
import type { TrainingMetrics, Job } from '../types';
import { logger } from '../utils/logger';

export type { Job };
const QUEUE_PATH = path.join(CONFIG.DATA_DIR, 'jobs.json');

async function loadQueue(): Promise<Job[]> {
    try {
        const data = await fsPromises.readFile(QUEUE_PATH, 'utf8');
        return JSON.parse(data);
    } catch { return []; }
}
async function saveQueue(jobs: Job[]): Promise<void> {
    await fsPromises.writeFile(QUEUE_PATH, JSON.stringify(jobs, null, 2));
}

export async function getQueue(): Promise<Job[]> { return loadQueue(); }
export async function enqueueJob(configPath: string): Promise<Job> {
    const jobs = await loadQueue();
    const job: Job = { id: crypto.randomUUID(), configPath, status: 'queued', createdAt: Date.now() };
    jobs.push(job);
    await saveQueue(jobs);
    broadcast({ type: 'queue', payload: jobs });
    return job;
}
export async function removeJob(id: string): Promise<boolean> {
    const jobs = await loadQueue();
    const idx = jobs.findIndex(j => j.id === id && j.status === 'queued');
    if (idx === -1) return false;
    jobs.splice(idx, 1);
    await saveQueue(jobs);
    broadcast({ type: 'queue', payload: jobs });
    return true;
}
async function updateJobStatus(id: string, status: Job['status']): Promise<void> {
    const jobs = await loadQueue();
    const job = jobs.find(j => j.id === id);
    if (job) { job.status = status; await saveQueue(jobs); broadcast({ type: 'queue', payload: jobs }); }
}
async function startNextJob(): Promise<void> {
    const jobs = await loadQueue();
    const next = jobs.find(j => j.status === 'queued');
    if (next && !runningProcess) {
        startTraining(next.configPath, false, next.id).catch(e => logger.error({ err: e }, 'queue job failed'));
    }
}

class LineBuffer {
    private buffer = '';

    push(chunk: string): string[] {
        this.buffer += chunk;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';
        return lines.filter(l => l.trim());
    }

    flush(): string[] {
        const remaining = this.buffer.trim();
        this.buffer = '';
        return remaining ? [remaining] : [];
    }
}

let runningProcess: ChildProcess | null = null;
let trainingLock: Promise<void> | null = null;
let currentJobId: string | undefined = undefined;
let stoppingManually = false;  // Guard against race condition in close handler

export async function startTraining(configPath: string, resume: boolean = false, queueJobId?: string): Promise<void> {
    const jobId = queueJobId;
    if (trainingLock) {
        throw new Error('Training already starting');
    }
    if (runningProcess) {
        throw new Error('Training already in progress');
    }

    let releaseLock: () => void;
    trainingLock = new Promise(resolve => { releaseLock = resolve; });

    const scriptPath = path.join(CONFIG.TRAINER_DIR, 'train.py');
    const absConfigPath = path.resolve(CONFIG.TRAINER_DIR, configPath);
    const pythonExec = getPythonPath();
    const args = [scriptPath, '--config', absConfigPath];
    if (resume === true) args.push('--resume');

    logger.info({ config: absConfigPath, python: pythonExec, resume }, 'starting training');

    runningProcess = spawn(pythonExec, args, {
        cwd: CONFIG.TRAINER_DIR
    });
    currentJobId = jobId || undefined;
    if (jobId) updateJobStatus(jobId, 'running').catch(e => logger.error({ err: e }, 'failed to update job status'));

    broadcast({ type: 'status', payload: { running: true, pid: runningProcess.pid, jobId: currentJobId } });

    const lineBuffer = new LineBuffer();

    runningProcess.stdout?.on('data', (data) => {
        const lines = lineBuffer.push(data.toString());
        for (const line of lines) {
            try {
                const obj = JSON.parse(line) as TrainingMetrics | { message?: string; error?: string };
                broadcast({ type: 'train-log', payload: obj });
            } catch {
                console.log('[Trainer]', line);
            }
        }
    });

    runningProcess.stderr?.on('data', (data) => {
        const msg = data.toString();
        console.error('[Trainer Error]', msg);
        broadcast({ type: 'train-log', payload: { stderr: msg } });
    });

    runningProcess.on('error', (err) => {
        logger.error({ err }, 'trainer process error');
        broadcast({ type: 'train-log', payload: { error: err.message } });
        if (stoppingManually) return;  // Skip if manual stop in progress
        if (currentJobId) updateJobStatus(currentJobId, 'failed').catch(e => logger.error({ err: e }, 'failed to update job status'));
        runningProcess = null;
        trainingLock = null;
        currentJobId = undefined;
        broadcast({ type: 'status', payload: { running: false, code: -1 } });
    });

    runningProcess.on('close', (code) => {
        for (const line of lineBuffer.flush()) {
            console.log('[Trainer]', line);  // Keep console for subprocess output
        }
        logger.info({ code }, 'training process exited');
        // Skip if stopTraining already handled cleanup
        if (stoppingManually) return;
        if (currentJobId) updateJobStatus(currentJobId, code === 0 ? 'done' : 'failed').catch(e => logger.error({ err: e }, 'failed to update job status'));
        runningProcess = null;
        trainingLock = null;
        currentJobId = undefined;
        broadcast({ type: 'status', payload: { running: false, code: code ?? undefined } });
        startNextJob().catch(e => logger.error({ err: e }, 'failed to start next job'));
    });

    // Release lock after process spawned successfully
    releaseLock!();
}

export async function stopTraining(): Promise<void> {
    if (!runningProcess) return;
    stoppingManually = true;

    try {
        const proc = runningProcess;
        const pid = proc.pid;

        // Try graceful SIGINT first (allows Python to checkpoint)
        try { proc.kill('SIGINT'); } catch { /* process may already be dead */ }
        broadcast({ type: 'status', payload: { running: true, stopping: true, pid } });

        // Wait up to 10s for graceful exit
        const gracefulExit = await new Promise<boolean>(resolve => {
            const timeout = setTimeout(() => resolve(false), 10000);
            proc.once('exit', () => { clearTimeout(timeout); resolve(true); });
        });

        // Force kill if still running
        if (!gracefulExit && runningProcess === proc) {
            try { proc.kill('SIGKILL'); } catch { /* already dead */ }
        }
        if (currentJobId) await updateJobStatus(currentJobId, 'failed');
        runningProcess = null;
        trainingLock = null;
        currentJobId = undefined;
        broadcast({ type: 'status', payload: { running: false, killed: true } });
        startNextJob().catch(e => logger.error({ err: e }, 'failed to start next job'));  // Check for queued jobs after manual stop
    } finally {
        stoppingManually = false;
    }
}

export function getStatus(): { running: boolean; pid?: number } {
    return {
        running: !!runningProcess,
        pid: runningProcess?.pid
    };
}
