/**
 * RAFT Protocol Constants and Configuration
 * 
 * These values follow the RAFT specification and are tuned for this project.
 */

module.exports = {
  // Election timeout range (milliseconds)
  // If follower doesn't receive heartbeat within this time, it starts election
  ELECTION_TIMEOUT_MIN: 500,
  ELECTION_TIMEOUT_MAX: 800,

  // Heartbeat interval (milliseconds)
  // Leader sends heartbeats to all followers at this interval
  HEARTBEAT_INTERVAL: 150,

  // RPC request timeout (milliseconds)
  // Wait this long for RPC response before considering it failed
  RPC_TIMEOUT: 5000,

  // Number of replicas needed for quorum (majority)
  // For 3 replicas: need 2 votes to form majority
  QUORUM_SIZE: 2,

  // Total replicas in cluster
  // This should be 3 for this project
  TOTAL_REPLICAS: 3,

  /**
   * Get random election timeout
   * Returns value between MIN and MAX
   */
  getRandomElectionTimeout: () => {
    return module.exports.ELECTION_TIMEOUT_MIN + 
           Math.random() * (module.exports.ELECTION_TIMEOUT_MAX - module.exports.ELECTION_TIMEOUT_MIN);
  },

  /**
   * Check if a term is valid
   * Used for validation
   */
  isValidTerm: (term) => {
    return typeof term === 'number' && term >= 0;
  },

  /**
   * Check if a replica ID is valid
   */
  isValidReplicaId: (id) => {
    return typeof id === 'string' && id.length > 0;
  }
};
