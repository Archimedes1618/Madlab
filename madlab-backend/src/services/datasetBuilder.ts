import fs from 'fs/promises';
import path from 'path';

const INSTILLATIONS_FILE = path.join(__dirname, '../data/instillations.json');
const DATASET_FILE = path.join(__dirname, '../data/dataset.jsonl');

export async function buildDataset(): Promise<number> {
    try {
        const raw = await fs.readFile(INSTILLATIONS_FILE, 'utf-8');
        const data = JSON.parse(raw);

        let lines: string[] = [];

        for (const pair of data.pairs) {
            if (!pair.enabled) continue;
            // Simple mapping: trigger -> input, response -> target
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
