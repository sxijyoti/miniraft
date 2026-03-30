/**
 * Election Timeout Manager
 * 
 * Manages the election timeout for a RAFT node.
 * When timeout fires, the node becomes a candidate.
 * 
 * Responsibilities:
 * - Start/reset election timeout on heartbeat reception
 * - Trigger election when timeout fires
 * - Cancel timeout when node becomes leader
 * - Random timeout to avoid split votes
 */

const { getRandomElectionTimeout } = require('./constants');

class ElectionTimeout {
  constructor(onTimeout) {
    this.onTimeout = onTimeout;
    this.timeoutId = null;
  }

  /**
   * Start or reset election timeout
   * Should be called:
   * - When node starts
   * - When heartbeat is received from leader
   * - When RequestVote is received
   */
  reset() {
    this.cancel();
    
    const timeout = getRandomElectionTimeout();
    this.timeoutId = setTimeout(() => {
      if (this.onTimeout) {
        this.onTimeout();
      }
    }, timeout);
  }

  /**
   * Cancel the election timeout
   * Should be called:
   * - When node becomes leader
   * - When node is shut down
   */
  cancel() {
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * Check if timeout is active
   */
  isActive() {
    return this.timeoutId !== null;
  }

  /**
   * Cleanup resources
   */
  destroy() {
    this.cancel();
    this.onTimeout = null;
  }
}

module.exports = ElectionTimeout;
