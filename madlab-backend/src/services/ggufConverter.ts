import { spawn } from 'child_process';
import path from 'path';
import { promises as fsPromises } from 'fs';
import { broadcast } from '../server';
import { CONFIG, getPythonPath } from '../config';
import type { ConversionJob } from '../types';
import { appendLineage } from './lineage';

export async function convertToGGUF(job: ConversionJob): Promise<void> {
    console.log(`Starting conversion for ${job.modelName} to ${job.quantization}`);
    broadcast({ type: 'status', payload: { message: `Converting ${job.modelName} to ${job.quantization}...` } });

    await fsPromises.mkdir(CONFIG.MODELS_DIR, { recursive: true });

    const pythonExec = getPythonPath();
    const hfPath = path.join(CONFIG.MODELS_DIR, 'tuned');
    const ggufFilename = `${job.modelName}-${job.quantization}.gguf`;
    const ggufPath = path.join(CONFIG.MODELS_DIR, ggufFilename);
    
    // G1 fix: Cross-platform script path (Windows: Scripts, Unix: bin)
    const binDir = process.platform === 'win32' ? 'Scripts' : 'bin';
    const scriptPath = path.join(CONFIG.TRAINER_DIR, 'venv', 'Lib', 'site-packages', 'bin', 'convert_hf_to_gguf.py');
    
    // Check script exists before spawning
    try {
        await fsPromises.access(scriptPath);
    } catch {
        throw new Error(`Converter script not found at ${scriptPath}`);
    }

    const args = [scriptPath, hfPath, '--outfile', ggufPath, '--outtype', job.quantization];

    return new Promise<void>((resolve, reject) => {
        const proc = spawn(pythonExec, args, { cwd: CONFIG.TRAINER_DIR });
        let timedOut = false;

        const timeout = setTimeout(() => {
            timedOut = true;
            proc.kill();
            reject(new Error('Conversion timed out after 30 minutes'));
        }, 30 * 60 * 1000);

        proc.on('error', (err) => {
            clearTimeout(timeout);
            reject(new Error(`Failed to spawn converter: ${err.message}`));
        });
        proc.stdout.on('data', (data) => console.log('[Converter]', data.toString()));
        proc.stderr.on('data', (data) => {
            const msg = data.toString();
            console.error('[Converter Error]', msg);
            broadcast({ type: 'train-log', payload: { stderr: msg } });
        });

        proc.on('close', async (code) => {
            clearTimeout(timeout);
            if (timedOut) return;
            if (code === 0) {
                console.log('Conversion successful');
                broadcast({ type: 'status', payload: { message: `Conversion complete: ${ggufFilename}` } });
                await appendLineage(job.modelName, 'gguf_conversion', { quantization: job.quantization, output: ggufFilename });
                resolve();
            } else {
                reject(new Error(`Conversion failed with code ${code}`));
            }
        });
    });
}
