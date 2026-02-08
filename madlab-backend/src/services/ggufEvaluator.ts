import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import { broadcast } from '../server';
import { CONFIG, getPythonPath } from '../config';

export async function evaluateGGUF(modelName: string, quantization: string, limit: number = 1.0): Promise<string> {
    console.log(`Starting evaluation for ${modelName} ${quantization} (limit: ${limit})`);
    broadcast({ type: 'status', payload: { message: `Evaluating ${modelName}-${quantization}...` } });

    await fsPromises.mkdir(CONFIG.MODELS_DIR, { recursive: true });

    const pythonExec = getPythonPath();
    const ggufPath = path.join(CONFIG.MODELS_DIR, `${modelName}-${quantization}.gguf`);

    let testsetPath = path.join(CONFIG.DATA_DIR, 'val.jsonl');
    if (!fs.existsSync(testsetPath)) {
        testsetPath = path.join(CONFIG.DATA_DIR, 'dataset.jsonl');
    }

    const reportFilename = `${modelName}-${quantization}-report.json`;
    const reportPath = path.join(CONFIG.MODELS_DIR, reportFilename);
    const scriptPath = path.join(CONFIG.TRAINER_DIR, 'evaluate_gguf.py');

    const args = [scriptPath, ggufPath, testsetPath, reportPath];
    if (limit < 1.0) {
        args.push('--limit', limit.toString());
    }

    return new Promise<string>((resolve, reject) => {
        const proc = spawn(pythonExec, args, { cwd: CONFIG.TRAINER_DIR });

        proc.on('error', (err) => reject(new Error(`Failed to spawn evaluator: ${err.message}`)));
        proc.stdout.on('data', (data) => {
            const str = data.toString();
            try {
                const obj = JSON.parse(str);
                if (obj.message) {
                    broadcast({ type: 'status', payload: { message: obj.message } });
                }
            } catch {
                console.log('[Evaluator]', str);
            }
        });

        proc.stderr.on('data', (data) => console.error('[Evaluator Err]', data.toString()));

        proc.on('close', (code) => {
            if (code === 0) {
                resolve(reportPath);
            } else {
                reject(new Error(`Evaluation failed with code ${code}`));
            }
        });
    });
}
