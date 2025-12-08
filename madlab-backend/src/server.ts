import express from 'express';
import http from 'http';
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

// Load environment variables
dotenv.config();

const app = express();
const port = parseInt(process.env.PORT || '8080', 10);

// Start services
startFileMonitor();

// Middleware
app.use(cors());
app.use(bodyParser.json());

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

// Broadcast helper for other modules
export const broadcast = (data: any) => {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
};

// Start server
server.listen(port, () => {
    console.log(`Madlab Backend listening on port ${port}`);
});

