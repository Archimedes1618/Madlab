import express from 'express';
import http from 'http';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import instillationsRouter from './routes/instillations';
import trainRouter from './routes/train';
import datasetsRouter from './routes/datasets';
import { modelsRouter } from './routes/models';
import proxyRouter from './routes/proxy';
import { startFileMonitor } from './services/fileMonitor';
import { CONFIG } from './config';
import type { WebSocketMessage } from './types';

// Load environment variables
dotenv.config();

// Ensure required directories exist on startup
const requiredDirs = [CONFIG.DATA_DIR, CONFIG.MODELS_DIR];
for (const dir of requiredDirs) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created directory: ${dir}`);
    }
}

// Ensure instillations.json exists with default content
if (!fs.existsSync(CONFIG.INSTILLATIONS_PATH)) {
    fs.writeFileSync(
        CONFIG.INSTILLATIONS_PATH,
        JSON.stringify({ version: '1.0', pairs: [] }, null, 2)
    );
    console.log('Created default instillations.json');
}

const app = express();

// Start services (async initialization)
(async () => {
    await startFileMonitor();
})();

// Middleware - CORS with specific origins
app.use(cors({
    origin: CONFIG.ALLOWED_ORIGINS,
    credentials: true
}));
app.use(bodyParser.json());

// Health check endpoint
app.get('/health', (_req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Routes
app.use('/instillations', instillationsRouter);
app.use('/train', trainRouter);
app.use('/datasets', datasetsRouter);
app.use('/models', modelsRouter);
app.use('/api', proxyRouter);

// Create HTTP server
const server = http.createServer(app);

// WebSocket Server
const wss = new WebSocketServer({ server, path: '/events' });

wss.on('connection', (ws: WebSocket) => {
    console.log('Client connected');
    ws.send(JSON.stringify({ type: 'status', payload: { message: 'Connected to Madlab Backend' } }));

    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

// Broadcast helper for other modules - now properly typed
export const broadcast = (data: WebSocketMessage) => {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
};

// Start server
server.listen(CONFIG.PORT, () => {
    console.log(`Madlab Backend listening on port ${CONFIG.PORT}`);
});
