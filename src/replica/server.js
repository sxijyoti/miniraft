const express = require('express');

const app = express();
app.use(express.json());

const REPLICA_ID = process.env.REPLICA_ID || 'unknown';
const PORT = Number(process.env.PORT || 4001);
const PEERS = (process.env.PEERS || '')
  .replace(/^\[/, '')
  .replace(/\]$/, '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

const state = {
  replicaId: REPLICA_ID,
  port: PORT,
  role: 'follower',
  currentTerm: 0,
  votedFor: null,
  log: []
};

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    replicaId: state.replicaId,
    role: state.role,
    currentTerm: state.currentTerm,
    logLength: state.log.length
  });
});

app.get('/state', (_req, res) => {
  res.json({ ...state, peers: PEERS });
});

app.post('/rpc/request-vote', (req, res) => {
  const { term, candidateId } = req.body || {};

  if (typeof term !== 'number') {
    return res.status(400).json({ error: 'term must be a number' });
  }

  if (term > state.currentTerm) {
    state.currentTerm = term;
    state.votedFor = null;
    state.role = 'follower';
  }

  let voteGranted = false;
  if (term === state.currentTerm && (state.votedFor === null || state.votedFor === candidateId)) {
    state.votedFor = candidateId;
    voteGranted = true;
  }

  return res.json({
    term: state.currentTerm,
    voteGranted,
    voterId: state.replicaId
  });
});

app.post('/rpc/append-entries', (req, res) => {
  const { term, leaderId, entries = [] } = req.body || {};

  if (typeof term !== 'number') {
    return res.status(400).json({ error: 'term must be a number' });
  }

  if (!Array.isArray(entries)) {
    return res.status(400).json({ error: 'entries must be an array' });
  }

  if (term < state.currentTerm) {
    return res.json({ term: state.currentTerm, success: false });
  }

  state.currentTerm = term;
  state.role = 'follower';
  state.log.push(...entries);

  return res.json({
    term: state.currentTerm,
    success: true,
    leaderId,
    logLength: state.log.length
  });
});

app.post('/rpc/heartbeat', (req, res) => {
  const { term, leaderId } = req.body || {};

  if (typeof term === 'number' && term >= state.currentTerm) {
    state.currentTerm = term;
    state.role = 'follower';
  }

  return res.json({
    ok: true,
    replicaId: state.replicaId,
    currentTerm: state.currentTerm,
    leaderId: leaderId || null
  });
});

app.post('/rpc/sync-log', (req, res) => {
  const { term, leaderId, log = [] } = req.body || {};

  if (typeof term !== 'number') {
    return res.status(400).json({ error: 'term must be a number' });
  }

  if (!Array.isArray(log)) {
    return res.status(400).json({ error: 'log must be an array' });
  }

  if (term >= state.currentTerm) {
    state.currentTerm = term;
    state.role = 'follower';
    state.log = [...log];
  }

  return res.json({
    ok: true,
    replicaId: state.replicaId,
    currentTerm: state.currentTerm,
    leaderId: leaderId || null,
    logLength: state.log.length
  });
});

async function pingPeers() {
  for (const peer of PEERS) {
    try {
      const response = await fetch(`${peer}/health`, { method: 'GET' });
      if (!response.ok) {
        console.warn(`[replica-${REPLICA_ID}] peer unhealthy: ${peer} status=${response.status}`);
        continue;
      }
      const health = await response.json();
      console.log(`[replica-${REPLICA_ID}] peer ok -> ${peer} id=${health.replicaId || 'n/a'}`);
    } catch (error) {
      console.warn(`[replica-${REPLICA_ID}] peer unreachable: ${peer} err=${error.message}`);
    }
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[replica-${REPLICA_ID}] listening on port ${PORT}`);
  console.log(`[replica-${REPLICA_ID}] peers=${PEERS.join(', ') || 'none'}`);

  pingPeers();
  setInterval(pingPeers, 15000);
});