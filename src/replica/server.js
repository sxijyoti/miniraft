const express = require('express');
const RaftState = require('../replicas/common/raftState');
const ElectionTimeout = require('../replicas/common/electionTimeout');
const ElectionManager = require('../replicas/common/election');
const Logger = require('../replicas/common/logger');
const { HEARTBEAT_INTERVAL, RPC_TIMEOUT } = require('../replicas/common/constants');

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

// Initialize RAFT state and utilities
const logger = new Logger(REPLICA_ID);
const state = new RaftState(REPLICA_ID);
let electionManager = null;
let electionTimeout = null;
let heartbeatInterval = null;

/**
 * Handler for when election timeout fires
 * Follower becomes candidate and starts election
 */
function onElectionTimeout() {
  logger.stateTransition(state.role, 'candidate', 'election timeout');

  if (!electionManager.startElection()) {
    return; // Election already in progress
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
    
    // Start heartbeat broadcast to followers
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
          electionManager.endElection();
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
}

app.get('/health', (_req, res) => {
  const snapshot = state.getSnapshot();
  res.json({
    status: 'ok',
    ...snapshot
  });
});

app.get('/state', (_req, res) => {
  const snapshot = state.getSnapshot();
  res.json({
    ...snapshot,
    peers: PEERS
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
  const { term, leaderId, entries = [], prevLogIndex = 0, prevLogTerm = 0 } = req.body || {};

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
    return res.json({ term: state.currentTerm, success: false });
  }

  // Update leader if needed
  if (state.leaderId !== leaderId) {
    state.leaderId = leaderId;
    logger.info(`Leader recognized: ${leaderId}`);
  }

  // Ensure follower role when receiving from leader
  if (!state.isFollower()) {
    state.toFollower(term);
    if (electionManager && electionManager.isElectionInProgress()) {
      electionManager.endElection();
    }
  }

  // Append entries to log
  state.appendEntries(entries);

  logger.rpc('SEND', 'append-entries', 'accepted', `logLen=${state.getLogLength()}`);

  return res.json({
    term: state.currentTerm,
    success: true,
    leaderId,
    logLength: state.getLogLength()
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
    
    logger.rpc('SEND', 'sync-log', 'accepted', `newLogLen=${state.getLogLength()}`);
  } else {
    logger.rpc('SEND', 'sync-log', 'rejected', `stale term`);
  }

  return res.json({
    ok: true,
    replicaId: state.replicaId,
    currentTerm: state.currentTerm,
    leaderId: state.leaderId,
    logLength: state.getLogLength()
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

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server listening on port ${PORT}`);
  logger.info(`Replica ID: ${REPLICA_ID}`);
  logger.info(`Peers: ${PEERS.join(', ') || 'none'}`);

  // Initialize election manager
  electionManager = new ElectionManager(state, PEERS, logger);

  // Initialize election timeout
  electionTimeout = new ElectionTimeout(onElectionTimeout);
  electionTimeout.reset(); // Start election timeout on startup

  // Periodic peer health check
  pingPeers();
  setInterval(pingPeers, 15000);

  logger.info(`RAFT node started in follower mode, waiting for heartbeats...`);
});