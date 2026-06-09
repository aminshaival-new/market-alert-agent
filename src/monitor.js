#!/usr/bin/env node
// Price Alert Monitor — runs every 3 minutes during market hours (9:00–15:35 IST)
// Reads alerts from config/alerts.json, fetches live prices, sends WhatsApp on trigger.

const fs = require('fs');
const path = require('path');
const { fetchPrices, fmt } = require('./tradingview');
const { sendWhatsApp } = require('./whatsapp');
const log = require('./logger');

const ALERTS_FILE  = path.join(__dirname, '../config/alerts.json');
const SETTINGS_FILE = path.join(__dirname, '../config/settings.json');

function loadAlerts() {
  try {
    return JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8'));
  } catch {
    return { alerts: [] };
  }
}
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveAlerts(data) {
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(data, null, 2));
}

function isMarketHours() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const h = ist.getHours(), m = ist.getMinutes();
  const mins = h * 60 + m;
  const open  = 9  * 60 + 0;
  const close = 15 * 60 + 35;
  const day = ist.getDay(); // 0=Sun, 6=Sat
  return day >= 1 && day <= 5 && mins >= open && mins <= close;
}

function isExpired(alert) {
  if (!alert.expiresAt) return false;
  return new Date() > new Date(alert.expiresAt);
}

function conditionMet(condition, currentPrice, targetPrice) {
  switch (condition) {
    case 'above':         return currentPrice > targetPrice;
    case 'below':         return currentPrice < targetPrice;
    case 'crosses_above': return currentPrice > targetPrice;
    case 'crosses_below': return currentPrice < targetPrice;
    default: return false;
  }
}

function buildAlertMessage(alert, currentPrice, change) {
  const dir   = alert.condition === 'above' || alert.condition === 'crosses_above' ? 'ABOVE 🚀' : 'BELOW 🔻';
  const emoji = change >= 0 ? '📈' : '📉';
  const chg   = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
  return (
    `🚨 *PRICE ALERT TRIGGERED*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${emoji} *${alert.name}* is ${dir} ₹${alert.price.toLocaleString('en-IN')}\n\n` +
    `• Current Price : ₹${fmt(currentPrice)}\n` +
    `• Target Level  : ₹${alert.price.toLocaleString('en-IN')}\n` +
    `• Change Today  : ${chg}\n` +
    `• Time (IST)    : ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `_Market Agent by Claude_`
  );
}

async function resetDailyTriggers() {
  // Reset all triggered flags at start of each market day (called at 9:00 AM)
  const data = loadAlerts();
  let changed = false;
  for (const a of data.alerts) {
    if (a.triggered) { a.triggered = false; changed = true; }
  }
  if (changed) { saveAlerts(data); log.info('Reset triggered flags for new market day'); }
}

async function runCheck() {
  log.info('Running price check...');
  const data = loadAlerts();
  const active = data.alerts.filter(a => a.active && !a.triggered);

  if (active.length === 0) {
    log.info('No active un-triggered alerts. Skipping API call.');
    return;
  }

  const symbols = [...new Set(active.map(a => a.symbol))];
  let prices;
  try {
    prices = await fetchPrices(symbols);
  } catch (err) {
    log.error('Failed to fetch prices: ' + err.message);
    return;
  }

  let changed = false;
  for (const alert of data.alerts) {
    if (!alert.active || alert.triggered) continue;

    // Auto-deactivate expired alerts
    if (isExpired(alert)) {
      log.info(`Alert "${alert.id}" expired at ${alert.expiresAt} — deactivating.`);
      alert.active = false;
      changed = true;
      continue;
    }

    const p = prices[alert.symbol];
    if (!p) { log.warn(`No price data for ${alert.symbol}`); continue; }

    const currentPrice = p.close;
    log.info(`${alert.name} (${alert.symbol}): ₹${fmt(currentPrice)} | Target: ${alert.condition} ₹${alert.price}`);

    if (conditionMet(alert.condition, currentPrice, alert.price)) {
      log.alert(`🚨 TRIGGERED: ${alert.name} ${alert.condition} ${alert.price} (current: ${currentPrice})`);
      const msg = buildAlertMessage(alert, currentPrice, p.change || 0);
      await sendWhatsApp(msg);
      alert.triggered    = true;
      alert.last_triggered = new Date().toISOString();
      changed = true;
    }
  }

  if (changed) saveAlerts(data);
}

// ── Main entry ──────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--reset')) {
    resetDailyTriggers().then(() => process.exit(0));
  } else {
    runCheck()
      .then(() => { log.info('Check complete.'); setTimeout(() => process.exit(0), 100); })
      .catch(err => { log.error(err.message); setTimeout(() => process.exit(1), 100); });
  }
}

module.exports = { runCheck, resetDailyTriggers };
