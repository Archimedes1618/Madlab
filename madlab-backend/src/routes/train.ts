import express from 'express';
import { startTraining, stopTraining, getStatus } from '../services/processManager';
import { buildDataset } from '../services/datasetBuilder';
import { convertToGGUF, evaluateGGUF, judgeModel } from '../services/modelConverter';
import path from 'path';
import fs from 'fs';

const router = express.Router();

// POST /train/start
router.post('/start', async (req, res) => {
    try {
        const { configPath } = req.body; // e.g., 'config/train.yaml'

        // 1. Build dataset
        const count = await buildDataset();
        console.log(`Dataset built with ${count} samples`);

        // 2. Start training
        startTraining(configPath || 'config/train.yaml');

        res.json({ message: 'Training started', datasetSize: count });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// POST /train/stop
router.post('/stop', (req, res) => {
    stopTraining();
    res.json({ message: 'Training stopped' });
});

// GET /train/status
router.get('/status', (req, res) => {
    res.json(getStatus());
});

// POST /train/convert
router.post('/convert', async (req, res) => {
    try {
        const { modelName, quantization } = req.body;
        await convertToGGUF({ modelName: modelName || 'tuned', quantization: quantization || 'q8_0' });
        res.json({ message: 'Conversion started' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// POST /train/evaluate
router.post('/evaluate', async (req, res) => {
    try {
        const { modelName, quantization, limit } = req.body;
        await evaluateGGUF(modelName || 'tuned', quantization || 'q8_0', limit ? parseFloat(limit) : 1.0);
        res.json({ message: 'Evaluation started' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// POST /train/judge
router.post('/judge', async (req, res) => {
    try {
        const { modelName, quantization, limit, sharpness } = req.body;
        // Run in background (don't await fully to return response)
        judgeModel(
            modelName || 'tuned',
            quantization || 'q8_0',
            limit ? parseFloat(limit) : 0.2, // Default 20%
            sharpness ? parseInt(sharpness) : 50
        ).catch(e => console.error('Judge Async Error:', e));

        res.json({ message: 'Magic Judge started' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// GET /train/artifacts
// Let's just use readdirSync for MVP
const MODELS_DIR = path.join(__dirname, '../../models');
const CONFIG_PATH = path.join(__dirname, '../../trainer/config/train.yaml');
import yaml from 'js-yaml';

router.get('/artifacts', (req, res) => {
    try {
        if (!fs.existsSync(MODELS_DIR)) {
            return res.json([]);
        }
        const files = fs.readdirSync(MODELS_DIR).filter(f => f.endsWith('.gguf') || f.endsWith('.json'));
        res.json(files.map(f => ({ name: f, url: `/models/${f}` }))); // Serve statically?
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// GET /train/config
router.get('/config', (req, res) => {
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            return res.status(404).json({ error: 'Config not found' });
        }
        const file = fs.readFileSync(CONFIG_PATH, 'utf8');
        const doc = yaml.load(file);
        res.json(doc);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});



// Model History Logic
const HISTORY_PATH = path.join(__dirname, '../../data/model_history.json');
function updateModelHistory(modelName: string) {
    try {
        let history: string[] = [];
        if (fs.existsSync(HISTORY_PATH)) {
            history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
        }
        if (!history.includes(modelName)) {
            history.unshift(modelName); // Add to top
            fs.writeFileSync(HISTORY_PATH, JSON.stringify(history.slice(0, 20)), 'utf8'); // Keep last 20
        }
    } catch (e) { console.error('Failed to update history', e); }
}

router.get('/history', (req, res) => {
    try {
        if (!fs.existsSync(HISTORY_PATH)) return res.json([]);
        res.json(JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')));
    } catch (e) { res.json([]); }
});

// POST /train/config
router.post('/config', (req, res) => {
    try {
        const newConfig = req.body;
        const yamlStr = yaml.dump(newConfig);
        fs.writeFileSync(CONFIG_PATH, yamlStr, 'utf8');

        // Update history
        if (newConfig.model && newConfig.model.name) {
            updateModelHistory(newConfig.model.name);
        }

        res.json({ message: 'Config updated' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
