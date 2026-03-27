# Log Replication & Data Consistency Implementation Guide
## Data-Replication Branch

---

##  File Structure (Complete)

```
miniraft/
├── src/
│   ├── gateway/
│   │   └── server.js                    # WebSocket gateway (Student D)
│   ├── replica/
│   │   └── server.js                     MODIFIED - Log replication logic added
│   └── replicas/
│       └── common/
│           ├── constants.js             (Student B - unchanged)
│           ├── election.js              (Student B - unchanged)
│           ├── electionTimeout.js       (Student B - unchanged)
│           ├── logger.js                (Student B - unchanged)
│           ├── raftState.js              Has commitIndex/lastApplied (Student B)
│           └── replicationManager.js     NEW ADDED - Log replication state tracking
```

### Key Files for Student C:
1. **replicationManager.js** - NEW (tracks leader replication progress)
2. **server.js** - MODIFIED (replication APIs + leader logic)
3. **raftState.js** - USES (commitIndex, lastApplied already defined)

---

##  What's Already Implemented

### 1. **RaftState.js** - Log & Commit State (by Student B)
Already has:
- `log[]` - Array of entries (persistent)
- `commitIndex` - Highest committed entry (volatile)
- `lastApplied` - Highest applied entry (volatile)
- `appendEntry()` - Add single entry
- `appendEntries()` - Add bulk entries
- `updateCommitIndex()` - Advance commit
- `getEntryAt()`, `getEntriesFrom()`, `getLogLength()`

### 2. **ReplicationManager.js** - Leader Replication Tracking
Tracks per-follower:
- `nextIndex[peer]` - Which index to send next
- `matchIndex[peer]` - Highest matched index on peer
- `resetForNewLeader()` - Initialize on leader election
- `replicateToPeer(peerUrl)` - Send entries to one peer
- `replicateToAll()` - Replicate to all followers
- `tryAdvanceCommitIndex()` - Commit when majority replicates
- `applyCommittedEntries()` - Apply committed entries locally

### 3. **Server.js** - RPC Endpoints & Leader Logic
 Implemented:
- **POST `/command`** - Client write endpoint (leader only)
- **POST `/rpc/request-vote`** - Election RPC (Student B)
- **POST `/rpc/append-entries`** - Log replication (follower receives)
  - Validates prevLogIndex/prevLogTerm
  - Detects log conflicts
  - Applies committed entries
- **POST `/rpc/heartbeat`** - Leader keepalive (Student B)
- **POST `/rpc/sync-log`** - Bulk log recovery
  - Replaces log from `fromIndex`
  - Updates leader info
  - Applies committed entries

---

## 🔗 Connection Points with Existing RAFT Logic

### Election → Replication Flow:
```
becomeLeader() [line 118]
  ↓
state.toLeader()              (Student B - raftState)
replicationManager.resetForNewLeader()  (Student C)
startHeartbeatBroadcast()     (already there)
  ↓
broadcastHeartbeat()          (line 148)
  + Send /rpc/heartbeat       (Student B logic)
  + replicationManager.replicateToAll()  (Student C - NEW)
```

### Client Write → Log Replication Flow:
```
POST /command [line 236]      (Student C - NEW)
  ↓
Extract command from request
Append to local log: state.appendEntry(entry)  (raftState)
Trigger replication: replicationManager.replicateToAll()
Return index to client
  ↓
Follower receives /rpc/append-entries [line 301]  (Student C)
  Validates prevLogIndex/prevLogTerm
  Appends entries: state.appendEntries(entries)
  Updates commitIndex from leader: state.updateCommitIndex(leaderCommit)
  Applies locally while lastApplied < commitIndex
```

### Replication → Commit Logic:
```
replicationManager.replicateToPeer(peerUrl)  [ReplicationManager]
  ↓
Peer responds with success=true
recordReplicationSuccess() - updates matchIndex[peer]
tryAdvanceCommitIndex()    - if majority matched, advance state.commitIndex
applyCommittedEntries()    - apply up to commitIndex
```

---

## Key APIs for LOG REPLICATION

### **1. POST /command** - Accept Client Writes
**Location:** `server.js` line 236-258  
**Caller:** Client applications  
**Only:** Leader accepts (400 error if not leader)

```javascript
POST /command
{
  "command": "user:set-name:Alice"
}

Response (Success):
{
  "ok": true,
  "index": 0,
  "term": 1,
  "leaderId": "replica-1"
}

Response (Not Leader):
{
  "error": "Not leader",
  "leaderId": "replica-2"  // redirect hint
}
```

### **2. POST /rpc/append-entries** - Replicate Entries
**Location:** `server.js` line 301-365  
**Caller:** Leader (sends), All replicas (receive)  
**Purpose:** Incremental log replication + heartbeat

```javascript
// Leader sends to followers:
{
  "term": 1,
  "leaderId": "replica-1",
  "prevLogIndex": 0,
  "prevLogTerm": 0,
  "entries": [
    { "term": 1, "command": "set-name:Alice", "timestamp": 1234567 }
  ],
  "leaderCommit": 0
}

// Follower responds:
{
  "term": 1,
  "success": true,
  "leaderId": "replica-1",
  "logLength": 1,
  "commitIndex": 0
}
```

### **3. POST /rpc/sync-log** - Bulk Recovery
**Location:** `server.js` line 408-465  
**Caller:** Leader (sends), Followers (receive)  
**Purpose:** If follower is far behind

```javascript
// Leader sends complete log from index N:
{
  "term": 1,
  "leaderId": "replica-1",
  "fromIndex": 5,
  "log": [
    { "term": 1, "command": "cmd5" },
    { "term": 1, "command": "cmd6" },
    { "term": 1, "command": "cmd7" }
  ],
  "leaderCommit": 7
}

// Follower replaces log[5:] with new entries and responds:
{
  "ok": true,
  "replicaId": "replica-2",
  "currentTerm": 1,
  "leaderId": "replica-1",
  "logLength": 8,
  "commitIndex": 7
}
```

---

##  Data Flow: Complete Example

### **Scenario: Client writes "user:set-name:Alice"**

```
Step 1: Client → Leader
  POST /command { "command": "user:set-name:Alice" }
  
Step 2: Leader (replica-1)
  server.js:242 - Check if leader 
  server.js:250 - Create entry { term:1, command:"...", timestamp:... }
  server.js:252 - Append to log: state.appendEntry(entry) → index=0
  server.js:256 - Trigger replication: replicationManager.replicateToAll()
  Return { ok: true, index: 0, term: 1, leaderId: "replica-1" }

Step 3: Leader → Followers (broadcast)
  replicationManager.replicateToPeer() for each follower
  Sends POST /rpc/append-entries with entries=[index 0]

Step 4: Followers (replica-2, replica-3) receive entries
  server.js:301 - Receive /rpc/append-entries
  server.js:330 - Validate prevLogIndex/prevLogTerm 
  server.js:346 - Append to log: state.appendEntries(entries)
  server.js:349-354 - Update commitIndex from leader
  server.js:356-362 - Apply committed entries locally
  Respond { success: true, logLength: 1, commitIndex: 0 }

Step 5: Leader tracks replication
  replicationManager.recordReplicationSuccess() updates matchIndex
  replicationManager.tryAdvanceCommitIndex()
  If 2/3 followers have replicated: advance commitIndex to 0
  applyCommittedEntries() apply locally

Step 6: All replicas now have entry applied
  state.lastApplied = 0
  Entry is now durable + replicated
```

---

##  State Transitions During Replication

```
┌─────────────────────────────────────────────────────┐
│ LEADER REPLICATION STATE MACHINE                    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Client writes entry                               │
│    ↓                                                │
│  state.appendEntry() → add to log                  │
│    ↓                                                │
│  replicationManager.replicateToAll()               │
│    ↓ (for each peer)                               │
│  Send POST /rpc/append-entries with prevLogIndex  │
│    ↓ (success)                                      │
│  recordReplicationSuccess() → update matchIndex     │
│    ↓ (if majority matched)                          │
│  tryAdvanceCommitIndex() → state.commitIndex++     │
│    ↓                                                │
│  applyCommittedEntries() → state.lastApplied++     │
│    ↓                                                │
│  Entry is now committed & safe                      │
│                                                     │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ FOLLOWER REPLICATION STATE MACHINE                  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Receive POST /rpc/append-entries                  │
│    ↓                                                │
│  Validate term, prevLogIndex, prevLogTerm         │
│    ↓                                                │
│  Delete conflicting entries after prevLogIndex     │
│    ↓                                                │
│  state.appendEntries(newEntries) → add to log     │
│    ↓                                                │
│  Update commitIndex from leader                    │
│    ↓                                                │
│  Apply committed entries: state.lastApplied++      │
│    ↓                                                │
│  Respond { success: true }                          │
│    ↓                                                │
│  Entries are replicated                             │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 🔧 ReplicationManager Class Structure

### **Properties:**
```javascript
replicationManager.state          // Reference to RaftState
replicationManager.peers          // Array of peer URLs
replicationManager.logger         // Logger instance
replicationManager.nextIndex      // { peerUrl: nextIndex }
replicationManager.matchIndex     // { peerUrl: matchIndex }
```

### **Key Methods:**

| Method | Purpose | When Called |
|--------|---------|-------------|
| `resetForNewLeader()` | Initialize nextIndex/matchIndex | `becomeLeader()` |
| `replicateToPeer(url)` | Send entries to one peer | `replicateToAll()` → each peer |
| `replicateToAll()` | Replicate to all followers | Every `HEARTBEAT_INTERVAL` |
| `recordReplicationSuccess()` | Update matchIndex on success | Peer responds with success=true |
| `recordReplicationFailure()` | Backoff nextIndex on failure | Peer responds with success=false |
| `tryAdvanceCommitIndex()` | Check if we can commit | After each replication response |
| `applyCommittedEntries()` | Apply committed entries locally | After commitIndex advances |
| `getReplicationStatus()` | Return status snapshot | For diagnostics |

---

##  Execution Flow: Complete Code Path

### **When leader receives new command:**

```javascript
// Step 1: server.js line 236
app.post('/command', async (req, res) => {
  if (!state.isLeader()) {
    return res.status(400).json({ error: 'Not leader', leaderId: state.leaderId });
  }
  
  // Step 2: Extract command
  const { command } = req.body;
  
  // Step 3: Create log entry
  const entry = { term: state.currentTerm, command, timestamp: Date.now() };
  
  // Step 4: Append to local log (raftState.js)
  const index = state.appendEntry(entry);  // Returns index number
  
  // Step 5: Trigger replication to all followers
  replicationManager.replicateToAll();  // → replicationManager.js
  
  // Step 6: Return to client immediately (fire-and-forget)
  res.json({ ok: true, index, term: state.currentTerm, leaderId: REPLICA_ID });
});

// Meanwhile, in background:
// replicationManager.replicateToAll() [replicationManager.js]
//   ↓ for each peer
// replicationManager.replicateToPeer(peerUrl)
//   ↓
// Sends POST /rpc/append-entries with payload:
// {
//   term, leaderId, prevLogIndex, prevLogTerm,
//   entries: [the new entry],
//   leaderCommit: current commitIndex
// }
//   ↓ follower responds with { success, term, logLength }
// recordReplicationSuccess()/recordReplicationFailure()
//   ↓
// tryAdvanceCommitIndex()  // Check if majority has this entry
//   ↓ if majority matched:
// state.updateCommitIndex(newCommitIndex)
//   ↓
// applyCommittedEntries()  // Apply locally
```

---

##  Safety Guarantees Implemented

### **1. Majority Commit Rule (RAFT Core)**
- Entry committed only if replicated to majority
- Implemented in: `tryAdvanceCommitIndex()` (replicationManager.js)
- Checks: `QUORUM_SIZE` replicas have matchIndex >= entryIndex

### **2. Log Consistency via prevLogIndex/prevLogTerm**
- Before appending, follower validates previous entry
- Implemented in: `/rpc/append-entries` handler (server.js line 330)
- If mismatch: reject and leader decrements nextIndex (backoff)

### **3. Current Term Safety**
- Only commit entries from current term
- Implemented in: `tryAdvanceCommitIndex()` (replicationManager.js)
- Checks: `entry.term === state.currentTerm`

### **4. Follower State Enforcement**
- Followers refuse writes; redirect to leader
- Implemented in: `POST /command` (server.js line 237)
- Returns `leaderId` hint for client redirect

### **5. Conflict Resolution**
- Conflicting entries deleted on follower
- Implemented in: `/rpc/append-entries` (server.js line 343-346)
- Slice log at prevLogIndex before appending

---

## 📦 How to Deploy this Code

### **File Checklist:**
-  `src/replicas/common/replicationManager.js` - NEW, implemented
-  `src/replica/server.js` - MODIFIED, implemented
-  `src/replicas/common/raftState.js` - EXISTS (Student B)
-  Other RAFT files - Unchanged (Student B)

### **Environment Setup:**
```bash
# 3-node setup
REPLICA_ID=replica-1 PORT=4001 PEERS=http://localhost:4002,http://localhost:4003 node src/replica/server.js
REPLICA_ID=replica-2 PORT=4002 PEERS=http://localhost:4001,http://localhost:4003 node src/replica/server.js
REPLICA_ID=replica-3 PORT=4003 PEERS=http://localhost:4001,http://localhost:4002 node src/replica/server.js
```

### **Test Client Write:**
```bash
# Find current leader (check /health endpoint for leaderId)
curl -s http://localhost:4001/health | jq .leaderId

# Write command to leader
curl -X POST http://localhost:4001/command \
  -H "Content-Type: application/json" \
  -d '{"command":"user:set-name:Alice"}'

# Check replication across cluster
curl http://localhost:4001/state | jq .logLength
curl http://localhost:4002/state | jq .logLength
curl http://localhost:4003/state | jq .logLength
# All should match after replication
```

---

##  How This Connects to Student B's Election Logic

### **Independence:**
- Election logic (Student B) completely separate from replication (Student C)
- No modifications to election code needed
- Replication uses only public APIs of RaftState

### **Interaction Points:**
1. **becomeLeader()** - Called by election logic
   - Replication manager resets on new leader
   - Starts sending entries immediately

2. **broadcastHeartbeat()** - Parallels election system
   - Same interval (`HEARTBEAT_INTERVAL`)
   - Carries log entries in append-entries RPC

3. **Term Handling** - Shared
   - Higher term reverts to follower (both systems)
   - Cancels ongoing replication on term change

---

##  Summary: What Student C Owns

### **New Code:**
-  `replicationManager.js` - Leader-side state tracking
-  `POST /command` endpoint - Client write path
-  Log conflict detection - prevLogIndex/prevLogTerm validation
-  Commit index advancement - Majority commit logic
-  Entry application - lastApplied tracking

### **Uses Existing (Student B):**
- RaftState.js - log[], commitIndex, lastApplied
- ElectionManager - role transitions
- ElectionTimeout - same heartbeat interval
- RPC framework - fetch/Promise for network calls

### **Data Consistency Achieved:**
 Log replication to all followers  
 Majority commit guarantee  
 Conflict detection & resolution  
 Applied entries durability  
 Leader/follower separation  

---

**Status: IMPLEMENTATION COMPLETE FOR STUDENT C**  
All log replication and data consistency features implemented and ready to test.

