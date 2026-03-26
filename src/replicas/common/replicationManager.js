const { QUORUM_SIZE, RPC_TIMEOUT } = require('./constants');

class ReplicationManager {
  constructor(state, peers, logger) {
    this.state = state;
    this.peers = peers;
    this.logger = logger;

    // nextIndex: index of next log entry to send to each follower
    // matchIndex: index of highest log entry known to be replicated on follower
    this.nextIndex = {};
    this.matchIndex = {};

    this.resetForNewLeader();
  }

  resetForNewLeader() {
    const nextIdx = this.state.getLogLength();
    for (const peer of this.peers) {
      this.nextIndex[peer] = nextIdx;
      this.matchIndex[peer] = -1; // -1 means no entries replicated yet
    }
  }

  async replicateToAll() {
    // Called by leader heartbeat loop
    if (!this.state.isLeader()) {
      return;
    }

    for (const peerUrl of this.peers) {
      this.replicateToPeer(peerUrl).catch((err) => {
        this.logger.debug(`replicateToPeer failed ${peerUrl}: ${err.message}`);
      });
    }

    // After sending replication attempts, try commit
    this.tryAdvanceCommitIndex();
    this.applyCommittedEntries();
  }

  async replicateToPeer(peerUrl) {
    if (!this.state.isLeader()) {
      return;
    }

    const nextIdx = this.nextIndex[peerUrl];
    const prevLogIndex = nextIdx - 1;
    const prevLogTerm = prevLogIndex >= 0 ? this.state.getEntryAt(prevLogIndex)?.term || 0 : 0;

    const entries = this.state.getEntriesFrom(nextIdx);

    const payload = {
      term: this.state.currentTerm,
      leaderId: this.state.replicaId,
      entries,
      prevLogIndex,
      prevLogTerm,
      leaderCommit: this.state.commitIndex
    };

    try {
      const response = await Promise.race([
        fetch(`${peerUrl}/rpc/append-entries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), RPC_TIMEOUT)
        )
      ]);

      if (!response.ok) {
        this.logger.debug(`Append entries to ${peerUrl} returned ${response.status}`);
        return;
      }

      const result = await response.json();

      if (result.term > this.state.currentTerm) {
        // higher term seen; follower is behind, election manager handles this elsewhere
        this.logger.info(`Higher term detected ${result.term} from ${peerUrl}`);
        return;
      }

      if (result.success) {
        this.matchIndex[peerUrl] = nextIdx + entries.length - 1;
        this.nextIndex[peerUrl] = this.matchIndex[peerUrl] + 1;
        this.logger.rpc('SEND', 'append-entries', 'success', `peer=${peerUrl} ${this.matchIndex[peerUrl]}`);
      } else {
        // conflict: decrement nextIndex and retry later
        this.nextIndex[peerUrl] = Math.max(0, this.nextIndex[peerUrl] - 1);
        this.logger.rpc('SEND', 'append-entries', 'failure', `peer=${peerUrl} decrease nextIndex`);
      }
    } catch (err) {
      this.logger.debug(`append-entries request ${peerUrl} failed: ${err.message}`);
    }
  }

  tryAdvanceCommitIndex() {
    if (!this.state.isLeader()) {
      return;
    }

    const N = this.state.getLogLength() - 1;
    for (let idx = this.state.commitIndex + 1; idx <= N; idx++) {
      const replicatedCount = Object.values(this.matchIndex).filter((match) => match >= idx).length + 1; // include leader
      if (replicatedCount >= QUORUM_SIZE) {
        const entry = this.state.getEntryAt(idx);
        if (entry && entry.term === this.state.currentTerm) {
          this.state.updateCommitIndex(idx);
          this.logger.info(`commitIndex advanced to ${idx}`);
        }
      }
    }
  }

  applyCommittedEntries() {
    while (this.state.lastApplied < this.state.commitIndex) {
      this.state.lastApplied += 1;
      const logEntry = this.state.getEntryAt(this.state.lastApplied);
      if (logEntry) {
        this.logger.info(`Applying log entry ${this.state.lastApplied}: ${JSON.stringify(logEntry)}`);
      }
    }
  }
}

module.exports = ReplicationManager;
