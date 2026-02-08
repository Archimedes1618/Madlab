import { promises as fs } from 'fs';
import path from 'path';
import { CONFIG } from '../config';

export interface LineageEntry {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface Lineage {
  model: string;
  created_at: string;
  entries: LineageEntry[];
}

function lineagePath(modelName: string): string {
  return path.join(CONFIG.MODELS_DIR, modelName, 'lineage.json');
}

async function ensureDir(modelName: string): Promise<void> {
  await fs.mkdir(path.join(CONFIG.MODELS_DIR, modelName), { recursive: true });
}

export async function getLineage(modelName: string): Promise<Lineage | null> {
  try {
    const data = await fs.readFile(lineagePath(modelName), 'utf8');
    return JSON.parse(data);
  } catch { return null; }
}

export async function appendLineage(modelName: string, event: string, data: Record<string, unknown>): Promise<void> {
  await ensureDir(modelName);
  const p = lineagePath(modelName);
  let lineage: Lineage;
  try {
    lineage = JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    lineage = { model: modelName, created_at: new Date().toISOString(), entries: [] };
  }
  lineage.entries.push({ event, timestamp: new Date().toISOString(), data });
  await fs.writeFile(p, JSON.stringify(lineage, null, 2));
}
