# Server.js Modifications for Log Replication

This file documents all modifications made to `src/replica/server.js` for log replication and data consistency implementation.

## Overview

The server.js file has been enhanced to support:
1. Client write path (POST /command)
2. Leader-side replication triggering
3. Enhanced follower-side append-entries handling
4. Log conflict detection
5. Bulk log recovery (sync-log)
6. Entry application to state

## Modifications Summary

### 1. Import ReplicationManager (Line 6)
```javascript
// ADD THIS LINE:
const ReplicationManager = require('../replicas/common/replicationManager');
```

### 2. Declare replicationManager Variable (Line 26)
```javascript
let replicationManager = null;  // ADDED FOR LOG REPLICATION
```

### 3. Enhance becomeLeader() (Line 127)
```javascript
// ADD THIS LINE before startHeartbeatBroadcast():
if (replicationManager) {
  replicationManager.resetForNewLeader();  // ADDED FOR LOG REPLICATION
}
```

### 4. Add POST /command Endpoint (After Line 235, before /rpc/request-vote)
```javascript
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
```

### 5. Enhance broadcastHeartbeat() (Line 192)
```javascript
// ADD THIS AT END OF FUNCTION:
// Also replicate log entries for this leader
if (replicationManager) {
  replicationManager.replicateToAll();  // ADDED FOR LOG REPLICATION
}
```

### 6. Enhance POST /rpc/append-entries (Lines 301-365)
```javascript
// REPLACE the entire append-entries handler with enhanced version:
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
    return res.json({ term: state.currentTerm, success: false });
  }

  // Simplified RAFT consistency check: match previous log entry
  // ADDED FOR LOG REPLICATION: conflict detection
  if (prevLogIndex >= 0) {
    const prevEntry = state.getEntryAt(prevLogIndex);
    if (!prevEntry || prevEntry.term !== prevLogTerm) {
      logger.rpc('SEND', 'append-entries', 'rejected', `log mismatch prevIndex=${prevLogIndex}`);
      return res.json({ term: state.currentTerm, success: false });
    }
  }

  // Update leader if needed
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
  // ADDED FOR LOG REPLICATION: conflict resolution
  const currentLength = state.getLogLength();
  const firstConflictIndex = prevLogIndex + 1;
  if (firstConflictIndex < currentLength) {
    state.log = state.log.slice(0, firstConflictIndex);
  }

  // Append entries to log
  if (entries.length > 0) {
    state.appendEntries(entries);
  }

  // Advance commit index
  // ADDED FOR LOG REPLICATION: apply committed entries
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
```

### 7. Enhance POST /rpc/sync-log (Lines 408-465)
```javascript
// REPLACE the sync-log handler with enhanced version:
// In the "Only accept sync from leader with valid term" section, ADD:

// Advanced commit index handling and entry application
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

// UPDATE response to include commitIndex:
return res.json({
  ok: true,
  replicaId: state.replicaId,
  currentTerm: state.currentTerm,
  leaderId: state.leaderId,
  logLength: state.getLogLength(),
  commitIndex: state.commitIndex  // ADDED
});
```

### 8. Initialize ReplicationManager (Line 491-492)
```javascript
// ADD THESE LINES in server.listen() callback:
// Initialize replication manager (leader replication state is maintained here)
replicationManager = new ReplicationManager(state, PEERS, logger);  // ADDED FOR LOG REPLICATION
```

## Files That Reference These Changes

- `../replicas/common/replicationManager.js` - New class
- `../replicas/common/raftState.js` - Uses existing methods (no changes needed)
- `../replicas/common/election.js` - Uses existing code (no changes needed)

## API Changes

### New Endpoint: POST /command
```
Request: { "command": "..." }
Response (Leader): { "ok": true, "index": 0, "term": 1, "leaderId": "replica-1" }
Response (Non-leader): { "error": "Not leader", "leaderId": "replica-1" }
```

### Enhanced: POST /rpc/append-entries
- Added: prevLogIndex/prevLogTerm conflict detection
- Added: leaderCommit parameter for commit index advancement
- Added: Entry application (lastApplied tracking)
- Added: Conflict resolution (delete stale entries)

### Enhanced: POST /rpc/sync-log
- Added: commitIndex parameter
- Added: Entry application
- Updated response to include commitIndex

## Testing These Changes

See `../tests/test_replication.sh` for complete test script.

Quick test:
```bash
# Start 3 replicas (see DEPLOYMENT.md)
REPLICA_ID=replica-1 PORT=4001 PEERS=http://localhost:4002,http://localhost:4003 node src/replica/server.js
REPLICA_ID=replica-2 PORT=4002 PEERS=http://localhost:4001,http://localhost:4003 node src/replica/server.js
REPLICA_ID=replica-3 PORT=4003 PEERS=http://localhost:4001,http://localhost:4002 node src/replica/server.js

# Send command to leader
curl -X POST http://localhost:4001/command \
  -H "Content-Type: application/json" \
  -d '{"command":"test"}'

# Verify replication
curl http://localhost:4001/state | jq .logLength
curl http://localhost:4002/state | jq .logLength
curl http://localhost:4003/state | jq .logLength
# All should show same logLength
```

## Key Design Decisions

1. **ReplicationManager is separate class** - Keeps replication logic modular
2. **Leader initiates replication** - Push model (not pull)
3. **Async fire-and-forget replication** - Non-blocking for heartbeat loop
4. **Per-peer state tracking** - nextIndex/matchIndex for each follower
5. **Immediate application** - Committed entries applied to state right away
