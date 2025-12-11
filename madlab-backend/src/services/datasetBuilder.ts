import fs from 'fs/promises';
import path from 'path';
import { CONFIG } from '../config';
import { getInstillations } from './instillationsCache';

const DATASET_FILE = path.join(CONFIG.DATA_DIR, 'dataset.jsonl');

export async function buildDataset(): Promise<number> {
    try {
        const data = await getInstillations();

        const lines: string[] = [];

        for (const pair of data.pairs) {
            if (!pair.enabled) continue;
            if (!pair.trigger || !pair.response) continue;

            const sample = {
                input: pair.trigger,
                target: pair.response
            };
            lines.push(JSON.stringify(sample));
        }

        await fs.writeFile(DATASET_FILE, lines.join('\n'));
        return lines.length;
    } catch (e) {
        console.error('Error building dataset:', e);
        throw e;
    }
}
