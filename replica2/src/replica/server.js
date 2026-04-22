const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const RaftState = require('../replicas/common/raftState');
const ElectionTimeout = require('../replicas/common/electionTimeout');
const ElectionManager = require('../replicas/common/election');
const ReplicationManager = require('../replicas/common/replicationManager'); // ADDED FOR LOG REPLICATION
const Logger = require('../replicas/common/logger');
const { HEARTBEAT_INTERVAL, RPC_TIMEOUT } = require('../replicas/common/constants');

const app = express();
app.use(express.json());

// Serve static frontend files
// The frontend is mounted at /app/src/frontend in the container
const frontendPath = path.join(__dirname, '../frontend');
app.use('/frontend', express.static(frontendPath));
app.get('/', (_req, res) => res.sendFile(path.join(frontendPath, 'index.html')));

const REPLICA_ID = process.env.REPLICA_ID || 'unknown';
const PORT = Number(process.env.PORT || 4001);
const PEERS = (process.env.PEERS || '')
  .replace(/^\[/, '')
  .replace(/\]$/, '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

// Initialize RAFT state and utilities
const logger = new Logger(REPLICA_ID);
const state = new RaftState(REPLICA_ID);
let electionManager = null;
let electionTimeout = null;
let heartbeatInterval = null;
let replicationManager = null; // ADDED FOR LOG REPLICATION

/**
 * Handler for when election timeout fires
 * Follower becomes candidate and starts election
 */
function onElectionTimeout() {
  logger.stateTransition(state.role, 'candidate', 'election timeout');

  // BUGFIX: If election is already in progress, end it first so we can start a new one
  // with an incremented term. This breaks deadlock in split-vote scenarios.
  if (electionManager.isElectionInProgress()) {
    logger.info('[ELECTION TIMEOUT] Ending current election and starting new one with incremented term');
    electionManager.endElection();
  }

  if (!electionManager.startElection()) {
    return; // Really shouldn't happen now, but keep as safety check
  }

  // Request votes from all peers
  requestVotesFromPeers();

  // Reset election timeout to prevent another timeout during voting
  electionTimeout.reset();
}

/**
 * Request votes from all peers
 * This is called when node becomes candidate
 */
async function requestVotesFromPeers() {
  const payload = electionManager.buildRequestVotePayload();
  
  logger.election('STARTED', {
    term: state.currentTerm,
    peers: PEERS.length,
    candidateId: REPLICA_ID
  });

  for (const peerUrl of electionManager.getPeersToVoteRequest()) {
    // Fire and forget - don't block on responses
    (async () => {
      try {
        const response = await Promise.race([
          fetch(`${peerUrl}/rpc/request-vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), RPC_TIMEOUT)
          )
        ]);

        if (!response.ok) {
          logger.rpc('RECV', 'request-vote', `error ${response.status}`);
          return;
        }

        const result = await response.json();
        
        // Higher term seen - revert to follower
        if (result.term > state.currentTerm) {
          state.updateTerm(result.term);
          state.toFollower(result.term);
          electionManager.endElection();
          electionTimeout.reset();
          logger.termUpdate(result.term, state.currentTerm - 1, 'from vote response');
          return;
        }

        // Vote received
        if (result.voteGranted) {
          logger.rpc('RECV', 'request-vote', 'granted', `from=${result.voterId}`);
          
          if (electionManager.recordVote(result.voterId, result.term)) {
            // Check if we won the election
            if (electionManager.hasWonElection()) {
              becomeLeader();
            }
          }
        } else {
          logger.rpc('RECV', 'request-vote', 'denied', `from=${result.voterId}`);
        }
      } catch (error) {
        logger.rpc('RECV', 'request-vote', 'error', error.message);
      }
    })();
  }
}

/**
 * Transition node to leader
 * Called when candidate receives majority votes
 */
function becomeLeader() {
  if (state.toLeader()) {
    logger.stateTransition('candidate', 'leader', 'won election');
    logger.election('WON', { term: state.currentTerm, votes: electionManager.getVoteCount() });
    
    electionManager.endElection();
    electionTimeout.cancel();

    if (replicationManager) {
      replicationManager.resetForNewLeader(); // ADDED FOR LOG REPLICATION
    }
    
    // Start heartbeat broadcast to followers (with replication)
    startHeartbeatBroadcast();
  }
}

/**
 * Start periodic heartbeat broadcast to followers
 * Leader sends heartbeats every HEARTBEAT_INTERVAL
 */
function startHeartbeatBroadcast() {
  // Cancel any existing heartbeat interval
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }

  heartbeatInterval = setInterval(() => {
    if (state.isLeader()) {
      broadcastHeartbeat();
    } else {
      // No longer leader, stop heartbeat
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }, HEARTBEAT_INTERVAL);
}

/**
 * Broadcast heartbeat to all followers
 * Followers reset their election timeout when they receive heartbeat
 */
function broadcastHeartbeat() {
  const payload = {
    term: state.currentTerm,
    leaderId: REPLICA_ID
  };

  // send heartbeat as lightweight keepalive
  for (const peerUrl of PEERS) {
    (async () => {
      try {
        const response = await Promise.race([
          fetch(`${peerUrl}/rpc/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), RPC_TIMEOUT)
          )
        ]);

        if (!response.ok) {
          logger.debug(`Heartbeat to ${peerUrl} failed with ${response.status}`);
          return;
        }

        const result = await response.json();

        // Higher term seen - revert to follower
        if (result.currentTerm > state.currentTerm) {
          state.updateTerm(result.currentTerm);
          state.toFollower(result.currentTerm);
          if (electionManager && electionManager.isElectionInProgress()) {
            electionManager.endElection();
          }
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
          electionTimeout.reset();
          logger.stateTransition('leader', 'follower', 'higher term from heartbeat');
        }
      } catch (error) {
        logger.debug(`Heartbeat to ${peerUrl} error: ${error.message}`);
      }
    })();
  }

  // Also replicate log entries for this leader
  if (replicationManager) {
    replicationManager.replicateToAll(); // ADDED FOR LOG REPLICATION
  }
}

app.get('/health', (_req, res) => {
  const snapshot = state.getSnapshot();
  res.json({
    status: 'ok',
    ...snapshot
  });
});

app.get('/clients', (_req, res) => {
  // Return count of connected WebSocket clients on this replica
  // Each replica independently tracks its own clients
  return res.json({ clients: wsClients.size });
});

app.get('/clients-global', async (_req, res) => {
  // Return total count of connected clients across all replicas
  let totalClients = wsClients.size;
  
  // Query other replicas in parallel with a short timeout
  const promises = PEERS.map(peerUrl =>
    Promise.race([
      fetch(`${peerUrl}/clients`, { timeout: 500 })
        .then(r => r.ok ? r.json() : { clients: 0 })
        .catch(() => ({ clients: 0 })),
      new Promise(resolve => setTimeout(() => resolve({ clients: 0 }), 500))
    ])
  );
  
  try {
    const results = await Promise.all(promises);
    results.forEach(result => {
      totalClients += result.clients || 0;
    });
  } catch (err) {
    // If aggregation fails, just return local count
    logger.warn(`Failed to aggregate global client count: ${err.message}`);
  }
  
  return res.json({ clients: totalClients });
});

app.get('/state', (_req, res) => {
  const snapshot = state.getSnapshot();
  res.json({
    ...snapshot,
    peers: PEERS
  });
});

app.post('/command', async (req, res) => {
  // ADDED FOR LOG REPLICATION: client write path for leader
  if (!state.isLeader()) {
    return res.status(400).json({ error: 'Not leader', leaderId: state.leaderId });
  }

  const { command } = req.body || {};
  if (!command) {
    return res.status(400).json({ error: 'command required' });
  }

  const entry = {
    term: state.currentTerm,
    command,
    timestamp: Date.now()
  };

  const index = state.appendEntry(entry);

  // Ensure leader replication state knows this entry is pending
  if (replicationManager) {
    replicationManager.nextIndex[REPLICA_ID] = state.getLogLength();
    // Trigger immediate replication attempt
    replicationManager.replicateToAll();
  }

  return res.json({
    ok: true,
    index,
    term: state.currentTerm,
    leaderId: REPLICA_ID
  });
});

app.post('/rpc/request-vote', (req, res) => {
  const { term, candidateId, lastLogIndex = 0, lastLogTerm = 0 } = req.body || {};

  if (typeof term !== 'number') {
    return res.status(400).json({ error: 'term must be a number' });
  }

  logger.rpc('RECV', 'request-vote', 'received', `term=${term}, from=${candidateId}`);

  // Higher term - update and revert to follower
  if (term > state.currentTerm) {
    state.updateTerm(term);
    state.toFollower(term);
    if (electionManager && electionManager.isElectionInProgress()) {
      electionManager.endElection();
    }
    electionTimeout.reset();
    logger.stateTransition('any', 'follower', `higher term ${term}`);
  }

  let voteGranted = false;

  // Vote if:
  // 1. Term matches current term
  // 2. Haven't voted yet OR voted for same candidate
  if (term === state.currentTerm && state.vote(candidateId)) {
    voteGranted = true;
    logger.rpc('SEND', 'request-vote', 'granted', `to=${candidateId}`);
    electionTimeout.reset(); // Reset timeout after receiving vote request
  } else {
    logger.rpc('SEND', 'request-vote', 'denied', `to=${candidateId}`);
  }

  return res.json({
    term: state.currentTerm,
    voteGranted,
    voterId: state.replicaId
  });
});

app.post('/rpc/append-entries', (req, res) => {
  const { term, leaderId, entries = [], prevLogIndex = -1, prevLogTerm = 0, leaderCommit = 0 } = req.body || {};

  if (typeof term !== 'number') {
    return res.status(400).json({ error: 'term must be a number' });
  }

  if (!Array.isArray(entries)) {
    return res.status(400).json({ error: 'entries must be an array' });
  }

  logger.rpc('RECV', 'append-entries', 'received', `term=${term}, entries=${entries.length}`);

  // Higher term - revert to follower
  if (term > state.currentTerm) {
    state.updateTerm(term);
    state.toFollower(term);
    if (electionManager && electionManager.isElectionInProgress()) {
      electionManager.endElection();
    }
    logger.stateTransition('any', 'follower', `higher term ${term}`);
  }

  electionTimeout.reset(); // Reset on any valid message from leader

  // Reject if term is old
  if (term < state.currentTerm) {
    logger.rpc('SEND', 'append-entries', 'rejected', `stale term`);
    return res.json({ term: state.currentTerm, success: false, logLength: state.getLogLength() });
  }

  // Simplified RAFT consistency check: match previous log entry
  if (prevLogIndex >= 0) {
    const prevEntry = state.getEntryAt(prevLogIndex);
    if (!prevEntry || prevEntry.term !== prevLogTerm) {
      logger.rpc('SEND', 'append-entries', 'rejected', `log mismatch prevIndex=${prevLogIndex}`);
      return res.json({ term: state.currentTerm, success: false, logLength: state.getLogLength() });
    }
  }

  // Update leader info
  if (state.leaderId !== leaderId) {
    state.leaderId = leaderId;
    logger.info(`Leader recognized: ${leaderId}`);
  }

  // Become follower under leader
  if (!state.isFollower()) {
    state.toFollower(term);
    if (electionManager && electionManager.isElectionInProgress()) {
      electionManager.endElection();
    }
  }

  // Delete conflicting entries after prevLogIndex
  const currentLength = state.getLogLength();
  const firstConflictIndex = prevLogIndex + 1;
  if (firstConflictIndex < currentLength) {
    state.log = state.log.slice(0, firstConflictIndex);
  }

  // Append new log entries from leader
  if (entries.length > 0) {
    state.appendEntries(entries);
  }

  // Advance commit index
  const lastNewIndex = state.getLogLength() - 1;
  const newCommit = Math.min(leaderCommit, lastNewIndex);
  if (newCommit > state.commitIndex) {
    state.updateCommitIndex(newCommit);
  }

  // Apply committed entries locally
  const applyLocal = () => {
    while (state.lastApplied < state.commitIndex) {
      state.lastApplied += 1;
      const logEntry = state.getEntryAt(state.lastApplied);
      if (logEntry) {
        logger.info(`Applied log entry ${state.lastApplied}: ${JSON.stringify(logEntry)}`);
      }
    }
  };
  applyLocal();

  logger.rpc('SEND', 'append-entries', 'accepted', `logLen=${state.getLogLength()} commitIndex=${state.commitIndex}`);

  return res.json({
    term: state.currentTerm,
    success: true,
    leaderId,
    logLength: state.getLogLength(),
    commitIndex: state.commitIndex
  });
});

app.post('/rpc/heartbeat', (req, res) => {
  const { term, leaderId } = req.body || {};

  if (typeof term !== 'number') {
    return res.status(400).json({ error: 'term must be a number' });
  }

  logger.rpc('RECV', 'heartbeat', 'received', `term=${term}, from=${leaderId}`);

  // Higher term - revert to follower
  if (term > state.currentTerm) {
    state.updateTerm(term);
    state.toFollower(term);
    if (electionManager && electionManager.isElectionInProgress()) {
      electionManager.endElection();
    }
    logger.stateTransition('any', 'follower', `higher term ${term}`);
  }

  // Reset election timeout - leader is alive
  electionTimeout.reset();

  // Update leader if needed
  if (state.leaderId !== leaderId) {
    state.leaderId = leaderId;
    logger.info(`Leader confirmed: ${leaderId}`);
  }

  // Become follower if needed
  if (!state.isFollower()) {
    state.toFollower(term);
    if (electionManager && electionManager.isElectionInProgress()) {
      electionManager.endElection();
    }
  }

  logger.rpc('SEND', 'heartbeat', 'ok', '');

  return res.json({
    ok: true,
    replicaId: state.replicaId,
    currentTerm: state.currentTerm,
    leaderId: state.leaderId
  });
});

app.post('/rpc/broadcast-stroke', (req, res) => {
  const stroke = req.body;
  
  if (!stroke) {
    return res.status(400).json({ error: 'stroke payload required' });
  }

  logger.info(`[RPC] Received broadcast-stroke from leader, relaying to ${wsClients.size} clients`);
  
  // Broadcast to all connected clients on this replica
  broadcastStroke(stroke);
  
  return res.json({
    ok: true,
    clientsNotified: wsClients.size
  });
});

app.post('/rpc/forward-stroke', (req, res) => {
  const payload = req.body;
  logger.rpc('RECV', 'forward-stroke', `from follower, type=${payload?.type}`);
  
  // Only leader should receive forwarded strokes
  if (state.role !== 'leader') {
    return res.status(400).json({ error: 'Not leader' });
  }
  
  if (payload && payload.type === 'stroke') {
    // Process stroke as if received directly from client
    const entryIndex = state.appendEntry(payload);
    logger.info(`[LEADER] Received forwarded stroke, appended at index ${entryIndex}`);
    
    // Broadcast to own clients
    broadcastStroke(payload);
    
    // Replicate to followers
    if (replicationManager) {
      replicationManager.replicateToAll().catch(err => {
        logger.warn(`Replication error: ${err.message}`);
      });
    }
    
    // Notify followers to broadcast
    for (const peerUrl of PEERS) {
      (async () => {
        try {
          await fetch(`${peerUrl}/rpc/broadcast-stroke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        } catch (err) {
          logger.warn(`Failed to broadcast to ${peerUrl}: ${err.message}`);
        }
      })();
    }
  }
  
  return res.json({ ok: true });
});

app.post('/rpc/sync-log', (req, res) => {
  const { term, leaderId, fromIndex = 0, log = [] } = req.body || {};

  if (typeof term !== 'number') {
    return res.status(400).json({ error: 'term must be a number' });
  }

  if (!Array.isArray(log)) {
    return res.status(400).json({ error: 'log must be an array' });
  }

  logger.rpc('RECV', 'sync-log', 'received', `term=${term}, entries=${log.length}, fromIndex=${fromIndex}`);

  // Higher term - revert to follower
  if (term > state.currentTerm) {
    state.updateTerm(term);
    state.toFollower(term);
    if (electionManager && electionManager.isElectionInProgress()) {
      electionManager.endElection();
    }
  }

  electionTimeout.reset();

  // Only accept sync from leader with valid term
  if (term >= state.currentTerm) {
    state.currentTerm = term;
    state.role = 'follower';
    state.leaderId = leaderId;

    // Replace log from fromIndex onwards with provided entries
    state.log = state.log.slice(0, fromIndex).concat(log);

    // Advance commit index to leaderCommit if provided, else to end
    const leaderCommit = typeof req.body.leaderCommit === 'number' ? req.body.leaderCommit : state.commitIndex;
    const lastIndex = state.getLogLength() - 1;
    const newCommit = Math.min(leaderCommit, lastIndex);
    if (newCommit > state.commitIndex) {
      state.updateCommitIndex(newCommit);
    }

    // Apply committed entries
    while (state.lastApplied < state.commitIndex) {
      state.lastApplied += 1;
      const entry = state.getEntryAt(state.lastApplied);
      if (entry) {
        logger.info(`Applied log entry ${state.lastApplied}: ${JSON.stringify(entry)}`);
      }
    }

    logger.rpc('SEND', 'sync-log', 'accepted', `newLogLen=${state.getLogLength()} commitIndex=${state.commitIndex}`);
  } else {
    logger.rpc('SEND', 'sync-log', 'rejected', `stale term`);
  }

  return res.json({
    ok: true,
    replicaId: state.replicaId,
    currentTerm: state.currentTerm,
    leaderId: state.leaderId,
    logLength: state.getLogLength(),
    commitIndex: state.commitIndex
  });
});

async function pingPeers() {
  for (const peer of PEERS) {
    try {
      const response = await fetch(`${peer}/health`, { method: 'GET' });
      if (!response.ok) {
        logger.debug(`peer unhealthy: ${peer} status=${response.status}`);
        continue;
      }
      const health = await response.json();
      logger.debug(`peer ok -> ${peer} id=${health.replicaId || 'n/a'}`);
    } catch (error) {
      logger.debug(`peer unreachable: ${peer} err=${error.message}`);
    }
  }
}

// Graceful shutdown handler
function shutdown() {
  logger.info('Shutting down...');
  
  if (electionTimeout) {
    electionTimeout.destroy();
  }
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Create HTTP server for both REST API and WebSocket
const server = http.createServer(app);

// WebSocket server for state updates
const wss = new WebSocket.Server({ server });
const wsClients = new Set();

// Broadcast RAFT state to all connected WebSocket clients
function broadcastRaftState() {
  const stateUpdate = {
    type: 'raft-state',
    replicaId: REPLICA_ID,
    role: state.role,
    term: state.currentTerm,
    leaderId: state.leaderId,
    logLength: state.getLogLength(),
    commitIndex: state.commitIndex,
    lastApplied: state.lastApplied,
    timestamp: Date.now()
  };
  
  const message = JSON.stringify(stateUpdate);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// Broadcast stroke to all connected clients
function broadcastStroke(stroke) {
  const message = JSON.stringify({
    type: 'stroke',
    ...stroke
  });
  
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// Handle WebSocket connections
wss.on('connection', (ws) => {
  wsClients.add(ws);
  logger.info(`[WS] Client connected (${wsClients.size})`);
  
  // Send initial state
  broadcastRaftState();
  
  ws.on('close', () => {
    wsClients.delete(ws);
    logger.info(`[WS] Client disconnected (${wsClients.size})`);
  });

  ws.on('message', async (data) => {
    try {
      const payload = JSON.parse(data.toString());
      logger.info(`[WS] Received message: type=${payload?.type}, role=${state.role}`);
      
      // Handle stroke from client (drawing command)
      if (payload && payload.type === 'stroke') {
        // If follower, forward stroke to leader
        if (state.role !== 'leader') {
          if (state.leaderId && state.leaderId !== REPLICA_ID) {
            // Find leader URL from PEERS list
            const leaderPeerUrl = PEERS.find(p => p.includes(`:${4001 + (state.leaderId - 1)}`)) ||
                                   PEERS[0]; // fallback to first peer
            logger.info(`[FOLLOWER] Forwarding stroke to leader at ${state.leaderId}`);
            
            try {
              // Forward stroke to leader immediately
              await fetch(`${leaderPeerUrl}/rpc/forward-stroke`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              });
            } catch (err) {
              logger.warn(`Failed to forward stroke to leader: ${err.message}`);
              ws.send(JSON.stringify({
                type: 'error',
                message: `Cannot reach leader for drawing: ${err.message}`
              }));
            }
          } else {
            ws.send(JSON.stringify({
              type: 'error',
              message: `Cannot draw: Replica ${REPLICA_ID} is a ${state.role}, leader unknown`
            }));
          }
          return;
        }

        // Leader appends stroke to log
        const entryIndex = state.appendEntry(payload);
        logger.info(`[LEADER] Appended stroke to log at index ${entryIndex}`);

        // Broadcast to own clients immediately
        broadcastStroke(payload);

        // Send to followers via replication
        if (replicationManager) {
          await replicationManager.replicateToAll();
        }

        // Notify followers to broadcast to their clients
        for (const peerUrl of PEERS) {
          (async () => {
            try {
              await fetch(`${peerUrl}/rpc/broadcast-stroke`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              });
            } catch (err) {
              logger.warn(`Failed to broadcast stroke to ${peerUrl}: ${err.message}`);
            }
          })();
        }
      }
    } catch (err) {
      logger.warn(`[WS] Error handling message: ${err.message}`);
    }
  });
});

// Update RAFT state and broadcast to clients whenever state changes
const originalToFollower = state.toFollower.bind(state);
state.toFollower = function(term) {
  const changed = originalToFollower(term);
  if (changed) broadcastRaftState();
  return changed;
};

const originalToCandidate = state.toCandidate.bind(state);
state.toCandidate = function() {
  const result = originalToCandidate();
  broadcastRaftState();
  return result;
};

const originalToLeader = state.toLeader.bind(state);
state.toLeader = function() {
  const changed = originalToLeader();
  if (changed) broadcastRaftState();
  return changed;
};

const originalUpdateTerm = state.updateTerm.bind(state);
state.updateTerm = function(term) {
  const result = originalUpdateTerm(term);
  if (result) broadcastRaftState();
  return result;
};

server.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server listening on port ${PORT}`);
  logger.info(`Replica ID: ${REPLICA_ID}`);
  logger.info(`Peers: ${PEERS.join(', ') || 'none'}`);

  // Initialize election manager
  electionManager = new ElectionManager(state, PEERS, logger);

  // Initialize replication manager (leader replication state is maintained here)
  replicationManager = new ReplicationManager(state, PEERS, logger); // ADDED FOR LOG REPLICATION

  // Initialize election timeout
  electionTimeout = new ElectionTimeout(onElectionTimeout);
  const startupElectionDelay = 150 + Math.floor(Math.random() * 600);
  setTimeout(() => {
    if (electionTimeout) {
      electionTimeout.reset();
      logger.info(`Initial election timeout armed after ${startupElectionDelay}ms`);
    }
  }, startupElectionDelay);

  // Periodic peer health check
  pingPeers();
  setInterval(pingPeers, 15000);

  // Periodic state broadcast to clients
  setInterval(() => broadcastRaftState(), 500);

  logger.info(`RAFT node started in follower mode, waiting for heartbeats...`);
});