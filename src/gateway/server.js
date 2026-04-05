const express = require('express');
const http = require('http');
const path = require('path');

const LeaderRouter = require('./leaderRouter');
const initWebsocket = require('./websocket');
const Logger = require('./logger');

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const REPLICA_ENDPOINTS = (process.env.REPLICA_ENDPOINTS || '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

const logger = new Logger('Gateway');

// Serve the frontend static files
app.use('/frontend', express.static(path.join(__dirname, '../frontend')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));

// Simple health and cluster endpoints
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'gateway', port: PORT });
});

const leaderRouter = new LeaderRouter(REPLICA_ENDPOINTS, logger);

app.get('/leader', (_req, res) => {
  res.json({ leader: leaderRouter.getLeader() });
});

// Leader will POST committed entries here; broadcast them to clients
app.post('/commit', (req, res) => {
  const payload = req.body;
  if (!payload) return res.status(400).json({ error: 'missing payload' });
  // Broadcast to connected websocket clients
  if (wssAdapter) {
    wssAdapter.broadcast(payload);
    logger.event('STROKE_COMMITTED', { from: payload.replicaId || 'leader', type: payload.type });
  }
  return res.json({ ok: true });
});

app.get('/cluster', (_req, res) => {
  res.json({ replicas: REPLICA_ENDPOINTS });
});

app.get('/clients', (_req, res) => {
  return res.json({ clients: wssAdapter ? wssAdapter.clientCount() : 0 });
});

const server = http.createServer(app);

// initialize websocket server and adapter
let wssAdapter = null;
const wss = initWebsocket(server, leaderRouter, logger);
wssAdapter = wss;

// Periodic leader discovery to keep routing fresh and notify clients on changes
setInterval(async () => {
  const oldLeader = leaderRouter.getLeader();
  try {
    const discovered = await leaderRouter.discoverLeader();
    if (discovered && discovered !== oldLeader) {
      logger.event('ROUTE', { action: 'leader_changed', leader: discovered });
      if (wssAdapter) {
        try { wssAdapter.broadcast({ type: 'leader', leader: discovered }); } catch (e) { logger.warn('broadcast leader change failed: ' + e.message); }
      }
    }
  } catch (err) {
    logger.warn('discoverLeader err: ' + err.message);
  }
}, 5000);

server.listen(PORT, '0.0.0.0', () => {
  logger.info(`listening on port ${PORT}`);
  if (REPLICA_ENDPOINTS.length > 0) {
    logger.info(`known replicas: ${REPLICA_ENDPOINTS.join(', ')}`);
  }
});