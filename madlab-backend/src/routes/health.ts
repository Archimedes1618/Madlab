import { Router } from 'express';
import os from 'os';
import path from 'path';
import { exec } from 'child_process';
import { CONFIG, getPythonPath } from '../config';

const router = Router();

interface SystemHealth {
    cpu: number;
    memory: { used: number; total: number; percent: number };
    disk?: { free: number; total: number; percent: number };
    gpu?: { name: string; memUsed: number; memTotal: number; utilization: number };
}

router.get('/system', async (_req, res) => {
    const cpus = os.cpus();
    const cpuUsage = cpus.reduce((acc, cpu) => {
        const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
        return acc + (1 - cpu.times.idle / total);
    }, 0) / cpus.length * 100;

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    const health: SystemHealth = {
        cpu: Math.round(cpuUsage),
        memory: {
            used: usedMem,
            total: totalMem,
            percent: Math.round(usedMem / totalMem * 100)
        }
    };

    // Try nvidia-smi for GPU stats (non-blocking)
    try {
        const gpuStats = await new Promise<string>((resolve, reject) => {
            exec('nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits', 
                { timeout: 2000 }, (err, stdout) => err ? reject(err) : resolve(stdout));
        });
        const [name, memUsed, memTotal, util] = gpuStats.trim().split(', ');
        health.gpu = {
            name: name.trim(),
            memUsed: parseInt(memUsed) * 1024 * 1024,
            memTotal: parseInt(memTotal) * 1024 * 1024,
            utilization: parseInt(util)
        };
    } catch { /* no nvidia-smi available */ }

    res.json(health);
});

// GET /health/gpus - list all available GPU devices (using PyTorch for correct CUDA ordering)
router.get('/gpus', async (_req, res) => {
    const gpuScript = path.join(CONFIG.TRAINER_DIR, 'gpu_info.py');
    const pythonExec = getPythonPath();

    try {
        const output = await new Promise<string>((resolve, reject) => {
            exec(`"${pythonExec}" "${gpuScript}"`, { timeout: 10000 }, (err, stdout) => {
                if (err) reject(err);
                else resolve(stdout);
            });
        });
        const gpus = JSON.parse(output.trim());
        res.json(gpus);
    } catch {
        // Fallback to nvidia-smi if Python fails
        try {
            const output = await new Promise<string>((resolve, reject) => {
                exec('nvidia-smi --query-gpu=index,name,memory.total,memory.free --format=csv,noheader,nounits',
                    { timeout: 3000 }, (err, stdout) => err ? reject(err) : resolve(stdout));
            });
            const gpus = output.trim().split('\n').filter(l => l.trim()).map(line => {
                const [index, name, memTotal, memFree] = line.split(', ');
                return {
                    index: parseInt(index.trim()),
                    name: name.trim(),
                    memTotal: parseInt(memTotal.trim()),
                    memFree: parseInt(memFree.trim()),
                    device: `cuda:${index.trim()}`
                };
            });
            res.json(gpus);
        } catch {
            res.json([]);
        }
    }
});

export default router;
