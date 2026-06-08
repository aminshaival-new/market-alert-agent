const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, '../logs/alerts.log');

function log(level, msg) {
  const ts = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const line = `[${ts}] [${level}] ${msg}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
}

module.exports = {
  info:  (msg) => log('INFO ', msg),
  warn:  (msg) => log('WARN ', msg),
  error: (msg) => log('ERROR', msg),
  alert: (msg) => log('ALERT', msg),
};
