class Logger {
  constructor(component = 'gateway') {
    this.component = component;
  }

  _fmt(level, message) {
    const ts = new Date().toISOString();
    return `[${ts}] [${this.component}] [${level}] ${message}`;
  }

  info(msg) { console.log(this._fmt('INFO', msg)); }
  warn(msg) { console.warn(this._fmt('WARN', msg)); }
  error(msg) { console.error(this._fmt('ERROR', msg)); }
  event(name, details = '') { console.log(this._fmt(name, JSON.stringify(details))); }
}

module.exports = Logger;
