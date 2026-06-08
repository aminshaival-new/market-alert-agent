// Alerts CRUD for bot commands — reads/writes config/alerts.json
const fs   = require('fs');
const path = require('path');

const ALERTS_FILE = path.join(__dirname, '../config/alerts.json');

function loadAlerts() {
  try {
    return JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8'));
  } catch { return []; }
}

function saveAlerts(alerts) {
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2));
}

function listAlerts() {
  const alerts = loadAlerts();
  if (!alerts.length) return '📋 No active alerts configured.\n\nTip: Say "alert me if nifty above 23500" to add one.';

  const active    = alerts.filter(a => a.active && !a.triggered);
  const triggered = alerts.filter(a => a.triggered);
  const expired   = alerts.filter(a => !a.active && !a.triggered);

  let msg = '📋 *YOUR PRICE ALERTS*\n━━━━━━━━━━━━━━━━━━━━\n';

  if (active.length) {
    msg += `\n✅ *Active (${active.length})*\n`;
    for (const a of active) {
      const exp = a.expiresAt ? ` | exp ${new Date(a.expiresAt).toLocaleDateString('en-IN', { day:'2-digit', month:'short', timeZone:'Asia/Kolkata' })}` : '';
      msg += `• ${a.name}: ${a.condition} ₹${a.price}${exp}\n`;
    }
  }

  if (triggered.length) {
    msg += `\n🔔 *Already Triggered (${triggered.length})*\n`;
    for (const a of triggered) msg += `• ${a.name}: ${a.condition} ₹${a.price}\n`;
  }

  if (expired.length) {
    msg += `\n⏰ *Expired/Inactive (${expired.length})*\n`;
    for (const a of expired) msg += `• ${a.name}: ${a.condition} ₹${a.price}\n`;
  }

  msg += '\n━━━━━━━━━━━━━━━━━━━━\n_Reply "add alert" or "remove [name]"_';
  return msg;
}

function addAlert(symbol, name, condition, price, expiresAt = null) {
  const alerts = loadAlerts();
  const id = `${symbol.toLowerCase()}-${condition}-${price}`.replace(/[^a-z0-9-]/g, '');

  // Check duplicate
  if (alerts.find(a => a.id === id)) {
    return `⚠️ Alert already exists: ${name} ${condition} ₹${price}`;
  }

  const alert = {
    id,
    symbol,
    name,
    condition,
    price,
    active: true,
    triggered: false
  };
  if (expiresAt) alert.expiresAt = expiresAt;

  alerts.push(alert);
  saveAlerts(alerts);

  const expStr = expiresAt ? `\n📅 Valid until: ${new Date(expiresAt).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric', timeZone:'Asia/Kolkata' })}` : '';
  return `✅ *Alert Set!*\n\n🔔 ${name}\n📊 Trigger: Price ${condition} ₹${price}${expStr}\n\n_I'll notify you on WhatsApp when this triggers._`;
}

function removeAlert(symbolOrId) {
  const alerts = loadAlerts();
  const q = symbolOrId.toLowerCase();
  const idx = alerts.findIndex(a =>
    a.id.includes(q) || a.name.toLowerCase().includes(q) || a.symbol.toLowerCase().includes(q)
  );
  if (idx === -1) return `❌ No alert found matching "${symbolOrId}"`;
  const removed = alerts.splice(idx, 1)[0];
  saveAlerts(alerts);
  return `🗑️ Removed alert: ${removed.name} ${removed.condition} ₹${removed.price}`;
}

module.exports = { listAlerts, addAlert, removeAlert };
