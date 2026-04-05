const WebSocket = require('ws');

const TARGET = process.env.TARGET || 'ws://localhost:3000';
const CLIENTS = Number(process.argv[2] || 5);
const INTERVAL_MS = Number(process.argv[3] || 500);

function randomStroke() {
  const pts = [];
  const count = 5 + Math.floor(Math.random() * 10);
  for (let i = 0; i < count; i++) pts.push({ x: Math.random() * 800, y: Math.random() * 600 });
  return { type: 'stroke', points: pts, color: '#'+Math.floor(Math.random()*16777215).toString(16), timestamp: Date.now() };
}

async function startClient(id) {
  const ws = new WebSocket(TARGET);
  ws.on('open', () => {
    console.log(`[client ${id}] connected`);
    setInterval(() => {
      const s = randomStroke();
      ws.send(JSON.stringify(s));
    }, INTERVAL_MS + Math.floor(Math.random() * 200));
  });
  ws.on('message', (m) => {
    // ignore
  });
  ws.on('close', () => console.log(`[client ${id}] closed`));
  ws.on('error', (e) => console.error(`[client ${id}] error`, e.message));
}

(async () => {
  for (let i = 0; i < CLIENTS; i++) startClient(i+1);
})();
