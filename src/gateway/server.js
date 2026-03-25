const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const REPLICA_ENDPOINTS = (process.env.REPLICA_ENDPOINTS || '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'gateway', port: PORT });
});

app.get('/cluster', (_req, res) => {
  res.json({ replicas: REPLICA_ENDPOINTS });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const clients = new Set();

wss.on('connection', (socket) => {
  clients.add(socket);
  console.log(`[gateway] websocket client connected. active=${clients.size}`);

  socket.on('message', (message) => {
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message.toString());
      }
    }
  });

  socket.on('close', () => {
    clients.delete(socket);
    console.log(`[gateway] websocket client disconnected. active=${clients.size}`);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[gateway] listening on port ${PORT}`);
  if (REPLICA_ENDPOINTS.length > 0) {
    console.log(`[gateway] known replicas: ${REPLICA_ENDPOINTS.join(', ')}`);
  }
});