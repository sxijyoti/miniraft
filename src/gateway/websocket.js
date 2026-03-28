const WebSocket = require('ws');

function initWebsocket(server, leaderRouter, logger) {
  const wss = new WebSocket.Server({ server });
  const clients = new Set();

  wss.on('connection', (socket) => {
    clients.add(socket);
    logger.info(`ws client connected (${clients.size})`);

    socket.on('message', async (data) => {
      let payload = null;
      try { payload = JSON.parse(data.toString()); } catch (err) { return; }

      // Only handle stroke messages from clients
      if (payload && payload.type === 'stroke') {
        try {
          await leaderRouter.sendCommand(payload);
          // Do not broadcast here — wait for leader to commit and POST /commit
          logger.event('STROKE_RECEIVED', { from: 'client', strokeSize: payload.points?.length || 0 });
        } catch (err) {
          logger.warn(`Failed to send stroke to leader: ${err.message}`);
          // Inform client that stroke wasn't accepted
          socket.send(JSON.stringify({ type: 'error', message: 'stroke not accepted: ' + err.message }));
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

  return { broadcast, clientCount: () => clients.size };
}

module.exports = initWebsocket;
