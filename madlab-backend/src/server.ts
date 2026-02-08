import express from 'express';
import http from 'http';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import bodyParser from 'body-parser';
import rateLimit from 'express-rate-limit';
import instillationsRouter from './routes/instillations';
import trainRouter from './routes/train';
import datasetsRouter from './routes/datasets';
import { modelsRouter } from './routes/models';
import proxyRouter from './routes/proxy';
import auditRouter from './routes/audit';
import backupRouter from './routes/backup';
import healthRouter from './routes/health';
import { startFileMonitor } from './services/fileMonitor';
import { startHealthProbe } from './services/lmStudioHealth';
import { CONFIG } from './config';
import type { WebSocketMessage } from './types';
import { logger, recordRequest, getMetrics } from './utils/logger';

// Ensure required directories exist on startup
const requiredDirs = [CONFIG.DATA_DIR, CONFIG.MODELS_DIR];
for (const dir of requiredDirs) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info({ dir }, 'created directory');
    }
}

// Ensure instillations.json exists with default content
if (!fs.existsSync(CONFIG.INSTILLATIONS_PATH)) {
    fs.writeFileSync(
        CONFIG.INSTILLATIONS_PATH,
        JSON.stringify({ version: '1.0', pairs: [] }, null, 2)
    );
    logger.info('created default instillations.json');
}

const app = express();

// Middleware - CORS (allow localhost and Electron file:// origins)
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (Electron, curl, etc.)
        if (!origin) return callback(null, true);
        // Allow configured origins
        if (CONFIG.ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        // Allow file:// protocol (Electron packaged app)
        if (origin.startsWith('file://')) return callback(null, true);
        // Allow localhost on any port
        if (origin.match(/^https?:\/\/localhost(:\d+)?$/)) return callback(null, true);
        callback(new Error('CORS not allowed'), false);
    },
    credentials: true
}));

// Rate limiting
app.use(rateLimit({
    windowMs: CONFIG.RATE_LIMIT_WINDOW_MS,
    max: CONFIG.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } }
}));

app.use(bodyParser.json());

// Request timing middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        recordRequest(duration, res.statusCode >= 400);
        logger.info({ method: req.method, path: req.path, status: res.statusCode, duration });
    });
    next();
});

// Static file serving for model artifacts
app.use('/artifacts', express.static(CONFIG.MODELS_DIR, { fallthrough: false }));

// Health check endpoint
app.get('/health', (_req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Metrics endpoint
app.get('/metrics', (_req, res) => {
    res.json(getMetrics());
});

// Routes
app.use('/instillations', instillationsRouter);
app.use('/train', trainRouter);
app.use('/datasets', datasetsRouter);
app.use('/models', modelsRouter);
app.use('/api', proxyRouter);
app.use('/api/audit', auditRouter);
app.use('/backup', backupRouter);
app.use('/health', healthRouter);

// Create HTTP server
const server = http.createServer(app);

// WebSocket Server
const wss = new WebSocketServer({ server, path: '/events' });

wss.on('connection', (ws: WebSocket, req) => {
    // Validate origin - allow localhost, file://, and configured origins
    const origin = req.headers.origin;
    const isAllowed = !origin ||
        CONFIG.ALLOWED_ORIGINS.includes(origin) ||
        origin.startsWith('file://') ||
        /^https?:\/\/localhost(:\d+)?$/.test(origin);

    if (!isAllowed) {
        logger.warn({ origin }, 'rejected WebSocket connection');
        ws.close(1008, 'Origin not allowed');
        return;
    }

    logger.info('WebSocket client connected');
    ws.send(JSON.stringify({ type: 'status', payload: { message: 'Connected to Madlab Backend' } }));

    ws.on('error', (err) => {
        logger.error({ err: err.message }, 'WebSocket error');
    });

    ws.on('close', () => {
        logger.info('WebSocket client disconnected');
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
    logger.info({ port: CONFIG.PORT }, 'Madlab Backend started');

    // Start services
    startHealthProbe(broadcast);
    startFileMonitor(broadcast).catch((err) => {
        logger.error({ err }, 'failed to start file monitor');
    });
});

// Graceful shutdown
function shutdown(signal: string) {
    logger.info({ signal }, 'shutting down');
    wss.close(() => {
        logger.info('WebSocket server closed');
        server.close(() => {
            logger.info('HTTP server closed');
            process.exit(0);
        });
    });
    // Force exit after 10s
    setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
