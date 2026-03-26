/**
 * Logger Utility
 * 
 * Provides consistent logging for RAFT nodes with timestamps and levels.
 * Helps with debugging and demo purposes.
 */

class Logger {
  constructor(replicaId) {
    this.replicaId = replicaId;
  }

  /**
   * Format log message with timestamp and replica ID
   */
  _format(level, message) {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${this.replicaId}] [${level}] ${message}`;
  }

  /**
   * Log info level message
   */
  info(message) {
    console.log(this._format('INFO', message));
  }

  /**
   * Log warning level message
   */
  warn(message) {
    console.warn(this._format('WARN', message));
  }

  /**
   * Log error level message
   */
  error(message) {
    console.error(this._format('ERROR', message));
  }

  /**
   * Log debug level message
   */
  debug(message) {
    if (process.env.DEBUG === 'true' || process.env.DEBUG === 'raft') {
      console.debug(this._format('DEBUG', message));
    }
  }

  /**
   * Log state transition with color
   */
  stateTransition(fromRole, toRole, reason = '') {
    const reasonStr = reason ? ` (${reason})` : '';
    this.info(`STATE TRANSITION: ${fromRole} → ${toRole}${reasonStr}`);
  }

  /**
   * Log election event
   */
  election(event, data) {
    const dataStr = Object.entries(data)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    this.info(`ELECTION [${event}] ${dataStr}`);
  }

  /**
   * Log RPC event
   */
  rpc(direction, method, status, details = '') {
    const detailsStr = details ? ` ${details}` : '';
    this.info(`RPC [${direction}] /${method} ${status}${detailsStr}`);
  }

  /**
   * Log term update
   */
  termUpdate(newTerm, oldTerm, reason = '') {
    const reasonStr = reason ? ` (${reason})` : '';
    this.info(`TERM UPDATE: ${oldTerm} → ${newTerm}${reasonStr}`);
  }

  /**
   * Log commit
   */
  commit(commitIndex, logLength) {
    this.info(`COMMIT: commitIndex=${commitIndex}, logLength=${logLength}`);
  }
}

module.exports = Logger;
