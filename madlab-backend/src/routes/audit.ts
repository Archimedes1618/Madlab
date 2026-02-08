import express from 'express';
import { queryEvents } from '../services/auditLogger';

const router = express.Router();

// GET /api/audit?limit=100&since=timestamp
router.get('/', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const since = req.query.since as string | undefined;
    const events = await queryEvents(limit, since);
    res.json(events);
});

export default router;
