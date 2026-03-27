# VISUAL ARCHITECTURE & DATA FLOW

##  System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    RAFT CLUSTER (3+ Replicas)                       │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │                                                            │   │
│  │  ┌─────────────────────────────────────┐                 │   │
│  │  │        REPLICA PROCESS              │                 │   │
│  │  │                                     │                 │   │
│  │  │  ┌──────────────────────────────┐   │                 │   │
│  │  │  │    RAFT STATE MACHINE       │   │                 │   │
│  │  │  │  (Election)                │   │                 │   │
│  │  │  │                              │   │                 │   │
│  │  │  │  ┌──────────────────────┐   │   │                 │   │
│  │  │  │  │ ElectionManager      │   │   │                 │   │
│  │  │  │  │ ElectionTimeout      │   │   │                 │   │
│  │  │  │  │ → role: leader|...   │   │   │                 │   │
│  │  │  │  │ → term: number       │   │   │                 │   │
│  │  │  │  └──────────────────────┘   │   │                 │   │
│  │  │  └──────────────────────────────┘   │                 │   │
│  │  │                                     │                 │   │
│  │  │  ┌──────────────────────────────┐   │                 │   │
│  │  │  │    RAFT STATE (Persistent)  │   │                 │   │
│  │  │  │  (Election + Replication)  │   │                 │   │
│  │  │  │                              │   │                 │   │
│  │  │  │  ┌──────────────────────┐   │   │                 │   │
│  │  │  │  │ currentTerm: 1       │   │   │                 │   │
│  │  │  │  │ votedFor: "r1"       │   │   │                 │   │
│  │  │  │  │ log: [               │   │   │                 │   │
│  │  │  │  │   {term:1, cmd:...}, │   │   │                 │   │
│  │  │  │  │   {term:1, cmd:...}  │   │   │                 │   │
│  │  │  │  │ ]                    │   │   │                 │   │
│  │  │  │  │                      │   │   │                 │   │
│  │  │  │  │ commitIndex: 1       │   │   │                 │   │
│  │  │  │  │ lastApplied: 1       │   │   │                 │   │
│  │  │  │  │ role: "leader"       │   │   │                 │   │
│  │  │  │  │ leaderId: "r1"       │   │   │                 │   │
│  │  │  │  └──────────────────────┘   │   │                 │   │
│  │  │  └──────────────────────────────┘   │                 │   │
│  │  │                                     │                 │   │
│  │  │  ┌──────────────────────────────┐   │                 │   │
│  │  │  │  REPLICATION ENGINE          │   │                 │   │
│  │  │  │  (Replication)              │   │                 │   │
│  │  │  │                              │   │                 │   │
│  │  │  │  ┌──────────────────────┐   │   │                 │   │
│  │  │  │  │ ReplicationManager   │   │   │                 │   │
│  │  │  │  │                      │   │   │                 │   │
│  │  │  │  │ nextIndex: {         │   │   │                 │   │
│  │  │  │  │   r2: 2,             │   │   │                 │   │
│  │  │  │  │   r3: 2              │   │   │                 │   │
│  │  │  │  │ }                    │   │   │                 │   │
│  │  │  │  │                      │   │   │                 │   │
│  │  │  │  │ matchIndex: {        │   │   │                 │   │
│  │  │  │  │   r2: 1,             │   │   │                 │   │
│  │  │  │  │   r3: 1              │   │   │                 │   │
│  │  │  │  │ }                    │   │   │                 │   │
│  │  │  │  └──────────────────────┘   │   │                 │   │
│  │  │  └──────────────────────────────┘   │                 │   │
│  │  │                                     │                 │   │
│  │  └─────────────────────────────────────┘                 │   │
│  │                                                            │   │
│  │  ┌─────────────────────────────────────┐                 │   │
│  │  │      HTTP/RPC ENDPOINTS             │                 │   │
│  │  │      (Express.js - server.js)       │                 │   │
│  │  │                                     │                 │   │
│  │  │  HTTP Endpoints:                   │                 │   │
│  │  │  ├─ GET  /health                   │                 │   │
│  │  │  ├─ GET  /state                    │                 │   │
│  │  │  └─ POST /command         [NEW]    │                 │   │
│  │  │                                     │                 │   │
│  │  │  RPC Endpoints:                    │                 │   │
│  │  │  ├─ POST /rpc/request-vote         │                 │   │
│  │  │  ├─ POST /rpc/heartbeat            │                 │   │
│  │  │  ├─ POST /rpc/append-entries       │                 │   │
│  │  │  └─ POST /rpc/sync-log             │                 │   │
│  │  │                                     │                 │   │
│  │  └─────────────────────────────────────┘                 │   │
│  │                                                            │   │
│  └────────────────────────────────────────────────────────────┘   │
│                          │                                        │
│                  (HTTP/RPC Network)                              │
│                          │                                        │
│           ┌──────────────┼──────────────┐                        │
│           ↓              ↓              ↓                        │
│  [Replica 2]    [Replica 3]    [Other Replicas]                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

##  State Transitions: Election → Replication

```
╔════════════════════════════════════════════════════════════════════╗
║        LEADERSHIP ELECTION (from raft-core)                       ║
║        ────────────────────────────────                            ║
║                                                                    ║
║  Follower → (timeout) → Candidate → (majority votes) → Leader    ║
║                                                                    ║
║  During election:                                                  ║
║  - ElectionManager tracks votes                                   ║
║  - Term incremented                                               ║
║  - votedFor set to self                                           ║
╚════════════════════════════════════════════════════════════════════╝
                                ↓
           onElectionWon: becomeLeader()
                                ↓
╔════════════════════════════════════════════════════════════════════╗
║        REPLICATION ENGINE INITIALIZATION                           ║
║        ─────────────────────────────────────────────               ║
║                                                                    ║
║  becomeLeader() {                                                  ║
║    state.toLeader()                                               ║
║    ↓                                                               ║
║    replicationManager.resetForNewLeader()                         ║
║    ↓                                                               ║
║    Initialize: nextIndex[all] = log.length                        ║
║    Initialize: matchIndex[all] = 0                                ║
║    ↓                                                               ║
║    startHeartbeatBroadcast()                                      ║
║  }                                                                 ║
║                                                                    ║
║  Result: Ready for replication                                    ║
╚════════════════════════════════════════════════════════════════════╝
                                ↓
        Every HEARTBEAT_INTERVAL (150ms):
                                ↓
╔════════════════════════════════════════════════════════════════════╗
║        REPLICATION LOOP                                            ║
║        ──────────────────────────                                 ║
║                                                                    ║
║  broadcastHeartbeat() {                                            ║
║    For each peer:                                                  ║
║      sendHeartbeat(peer)                                           ║
║    replicationManager.replicateToAll()  [NEW]                     ║
║      ↓                                                              ║
║      For each peer:                                                ║
║        replicateToPeer(peer)                                       ║
║  }                                                                 ║
║                                                                    ║
║  replicateToPeer(peer) {                                           ║
║    1. Get entries from nextIndex[peer]                            ║
║    2. Build payload with entries + prevLogIndex/Term             ║
║    3. Send POST /rpc/append-entries to peer                      ║
║    4. Handle response:                                            ║
║       - Success: recordReplicationSuccess()                       ║
║       - Failure: recordReplicationFailure()                       ║
║    5. tryAdvanceCommitIndex()                                     ║
║       - If majority has entry: commitIndex++                      ║
║    6. applyCommittedEntries()                                     ║
║       - Apply to state: lastApplied++                             ║
║  }                                                                 ║
╚════════════════════════════════════════════════════════════════════╝
```

---

##  Complete Client Write Flow

```
TIME    CLIENT                    LEADER                 FOLLOWER-1            FOLLOWER-2
────    ──────                    ──────                 ──────────            ──────────
  0ms   POST /command ────────────→
                                   ├─ Validate leader
                                   ├─ Create entry
                                   ├─ Append to log
                                   ├─ Return {index:0}
         ←────────────────────────┤

  1ms                            ├─ replicateToPeer(F1) ─────────→
                                   │   payload: {
                                   │     entries:[entry],
                                   │     prevLogIndex:...,
                                   │     prevLogTerm:...
                                   │   }
                                                                     ├─ Validate term
                                                                     ├─ Check prevLog*
                                                                     ├─ Append entry
                                                                     ├─ Update commitIndex
                                                                     ├─ Return {success:true}
                                   │                                 │
                                   ←──────────────────────────────┤

  2ms                            ├─ recordReplicationSuccess(F1)
                                   │  matchIndex[F1] = 0
                                   │
                                   ├─ replicateToPeer(F2) ─────────────→
                                                                                  ├─ Validate
                                                                                  ├─ Append
                                                                                  ├─ Return
                                   │                                             │
                                   ←────────────────────────────────────────┤

  3ms                            ├─ recordReplicationSuccess(F2)
                                   │  matchIndex[F2] = 0
                                   │
                                   ├─ tryAdvanceCommitIndex()
                                   │  Check: majority (2/3) has entry 0?
                                   │  YES! → commitIndex = 0
                                   │
                                   ├─ applyCommittedEntries()
                                   │  lastApplied = 0
                                   │   Entry applied locally

  4ms   Entry is COMMITTED  (replicated to 2/3, applied to all)
```

---

##  Conflict Resolution Scenario

```
SCENARIO: Follower has stale log entries

BEFORE:
  Leader:   log = [entry0, entry1, entry2] (term:1, 1, 1)
  Follower: log = [entry0_stale, entry1_stale] (term:1, 1)
            ↑ Conflict! entry1 differs (different term)

STEP 1: Leader sends append-entries
  Payload:
    prevLogIndex: 1
    prevLogTerm:  1
    entries: [entry2]

STEP 2: Follower validates
  Follower checks state.getEntryAt(1)
  Compares term: entry1_stale.term vs prevLogTerm
  MISMATCH! (1 vs 1 - assume different terms)
  Returns: { success: false }

STEP 3: Leader backoffs
  nextIndex[follower]--
  (Was 3, now 2)

STEP 4: Leader retries
  Payload:
    prevLogIndex: 0
    prevLogTerm:  1
    entries: [entry1, entry2]

STEP 5: Follower validates again
  Check getEntryAt(0) → entry0
  Matches! prevLogTerm = 1
  Delete entries from index 1: log.slice(0, 1)
  Append new: [entry1, entry2]
  SUCCESS!

AFTER:
  Leader:   log = [entry0, entry1, entry2]
Follower: log = [entry0, entry1, entry2]
            Logs converged!
```

---

##  Scale: How It Works with 5 Replicas

```
LEADER broadcasts to 4 followers:
  
  L ──append-entries──→ F1
  L ──append-entries──→ F2
  L ──append-entries──→ F3
  L ──append-entries──→ F4

Responses:
  L ←─success─────── F1  matchIndex[F1] = 5
  L ←─success─────── F2  matchIndex[F2] = 5
  L ←─success─────── F3  matchIndex[F3] = 5
  L ←─success─────── F4  matchIndex[F4] = 5

Majority check (QUORUM_SIZE = 3):
  All have entry: [L:5, F1:5, F2:5, F3:5, F4:5]
  Sort descending: [5, 5, 5, 5, 5]
  Take position [QUORUM_SIZE-1] = [2] = 5
  
  So: commitIndex can advance to 5
  Only need 3/5 to have it (majority)
```

---

## 🛡️ Safety: Why This Works

```
┌─────────────────────────────────────────────────────┐
│ SAFETY PROOF: Entry Durability                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│ If entry E is committed:                           │
│   → E is in majority (≥ QUORUM_SIZE replicas)      │
│   → If leader crashes, new leader must have E      │
│     (because any new leader must win election)     │
│   → To win election, candidate must have latest log│
│   → Majority of voters have E                      │
│   → Candidate must have E to get majority votes    │
│   → Therefore: E is never lost                     │
│                                                     │
| Result: Strong durability guarantee
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ SAFETY PROOF: Log Consistency                       │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Invariant: If entry E is at index N on replica R1,│
│            and same index on replica R2,           │
│            then E is identical on both             │
│                                                     │
│ Why:                                                │
│  1. Only leader can create entries (follower writes│
│     rejected)                                       │
│  2. Leader never overwrites entries                │
│  3. prevLogIndex/prevLogTerm validation ensures    │
│     followers only append if prior entries match   │
│  4. If conflict, entries are deleted (not          │
│     modified)                                      │
│                                                     │
| Result: Log consistency guaranteed
└─────────────────────────────────────────────────────┘
```

---

##  Decision Tree: Is It Safe to Use This Data?

```
CLIENT READS STATE:

  curl /state -> { "commitIndex": 5 }
  
  Did I write at index 5?
  ├─ YES: Check if (commitIndex ≥ 5)
  │       └─ YES: SAFE - Entry is durable
  │       └─ NO:  ⏳ WAITING - Not yet committed
  │
  └─ NO (reading what leader has):
      └─  SAFE - All replicas will have same
           (leader dominates; followers follow)
```

---

## Summary: System Architecture

```
┌─────────────────────────────────────────────────────┐
│  CLIENT LAYER                                       │
│  (Applications using RAFT)                          │
├─────────────────────────────────────────────────────┤
│  API LAYER (Express.js / server.js)                │
│  ├─ GET/POST endpoints                             │
│  ├─ JSON serialization                             │
│  └─ HTTP routing                                   │
├─────────────────────────────────────────────────────┤
│  REPLICATION ENGINE (ReplicationManager) [C]       │
│  ├─ nextIndex/matchIndex tracking                  │
│  ├─ Leader replication logic                       │
│  └─ Majority commit logic                          │
├─────────────────────────────────────────────────────┤
│  RAFT STATE MACHINE (RaftState.js)                 │
│  ├─ log[] storage                                  │
│  ├─ commitIndex / lastApplied                      │
│  ├─ role / term / leaderId                         │
│  └─ Entry append/retrieval                         │
├─────────────────────────────────────────────────────┤
│  ELECTION ENGINE (ElectionManager) [B]             │
│  ├─ Leader election                                │
│  ├─ Vote tracking                                  │
│  └─ Candidate/follower transitions                 │
├─────────────────────────────────────────────────────┤
│  NETWORK LAYER                                      │
│  ├─ HTTP/Promise-based fetch                       │
│  ├─ RPC timeout handling                           │
│  └─ Async concurrent requests                      │
└─────────────────────────────────────────────────────┘
```

---

**This architecture ensures:**
 Strong consistency across replicas  
 Failure tolerance (up to F failures with 2F+1 replicas)  
 Leader safety (only leader can commit)  
 Log safety (no entry loss after commit)  
 State machine consistency (all apply in same order)  

