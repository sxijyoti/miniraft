const WebSocket = require('ws');

function initWebsocket(server, leaderRouter, logger) {
  const wss = new WebSocket.Server({ server });
  const clients = new Set();

  // Global FIFO queue for strokes when leader is unavailable
  const queue = [];
  let flushing = false;

  async function flushQueue() {
    if (flushing || queue.length === 0) return;
    flushing = true;
    try {
      while (queue.length > 0) {
        const item = queue[0];
        try {
          logger.event('ROUTE', { action: 'flush', size: queue.length });
          await leaderRouter.sendCommand(item);
          queue.shift();
          logger.event('ROUTE', { action: 'flushed_one' });
        } catch (err) {
          // Failed to deliver current head; stop flushing and retry later
          logger.warn(`flushQueue: sendCommand failed: ${err.message}`);
          break;
        }
      }
    } finally {
      flushing = false;
    }
  }

  // Periodic flush
  const flushInterval = setInterval(() => flushQueue().catch((e) => logger.warn('flushQueue err: ' + e.message)), 500);

  wss.on('connection', (socket) => {
    clients.add(socket);
    logger.info(`ws client connected (${clients.size})`);

    socket.on('message', async (data) => {
      let payload = null;
      try { payload = JSON.parse(data.toString()); } catch (err) { return; }

      // Only handle stroke messages from clients
      if (payload && payload.type === 'stroke') {
        // Try to send immediately; if it fails, enqueue for later retry
        try {
          logger.event('ROUTE', { action: 'attempt_send', points: payload.points?.length || 0 });
          await leaderRouter.sendCommand(payload);
          logger.event('STROKE_RECEIVED', { from: 'client', strokeSize: payload.points?.length || 0 });
        } catch (err) {
          logger.warn(`Failed to send stroke to leader: ${err.message}. Enqueuing.`);
          queue.push(payload);
          // Acknowledge queueing to client (non-fatal)
          try { socket.send(JSON.stringify({ type: 'queued', message: 'stroke queued, will retry' })); } catch (_) {}
        }
      }
    });

    socket.on('close', () => {
      clients.delete(socket);
      logger.info(`ws client disconnected (${clients.size})`);
    });
  });

  function broadcast(obj) {
    const raw = JSON.stringify(obj);
    for (const c of clients) {
      if (c.readyState === WebSocket.OPEN) {
        c.send(raw);
      }
    }
  }

  function clientCount() { return clients.size; }

  // Graceful cleanup when server is closed
  wss.on('close', () => {
    clearInterval(flushInterval);
  });

  return { broadcast, clientCount };
}

module.exports = initWebsocket;
