const fs = require('fs');
const path = require('path');

const logDir  = path.join(__dirname, '../logs');
const logFile = path.join(logDir, 'alerts.log');

// Auto-create logs directory (needed on fresh GitHub Actions runner)
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

function log(level, msg) {
  const ts = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const line = `[${ts}] [${level}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(logFile, line + '\n'); } catch (_) { /* non-fatal */ }
}

module.exports = {
  info:  (msg) => log('INFO ', msg),
  warn:  (msg) => log('WARN ', msg),
  error: (msg) => log('ERROR', msg),
  alert: (msg) => log('ALERT', msg),
};
