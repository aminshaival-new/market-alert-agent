#!/usr/bin/env node
// Alert Manager — Claude uses this to add/remove/list alerts on your behalf
// Usage:
//   node manage-alerts.js add   --symbol NSE:NIFTY    --name "Nifty 50" --condition above --price 23300
//   node manage-alerts.js add   --symbol NSE:RELIANCE --name "RIL"      --condition below --price 1250
//   node manage-alerts.js remove --id nifty-above-23300
//   node manage-alerts.js list
//   node manage-alerts.js clear-triggered

const fs   = require('fs');
const path = require('path');
const ALERTS_FILE = path.join(__dirname, '../config/alerts.json');

function load() { return JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8')); }
function save(d) { fs.writeFileSync(ALERTS_FILE, JSON.stringify(d, null, 2)); }

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1] || true;
      i++;
    }
  }
  return args;
}

const [,, cmd, ...rest] = process.argv;
const opts = parseArgs(rest);

switch (cmd) {
  case 'add': {
    const { symbol, name, condition, price } = opts;
    if (!symbol || !name || !condition || !price) {
      console.error('Usage: manage-alerts.js add --symbol SYM --name "Name" --condition above|below --price NUM');
      process.exit(1);
    }
    const validConditions = ['above', 'below', 'crosses_above', 'crosses_below'];
    if (!validConditions.includes(condition)) {
      console.error('condition must be one of:', validConditions.join(', '));
      process.exit(1);
    }
    const data  = load();
    const id    = slugify(`${name}-${condition}-${price}`);
    const exists = data.alerts.find(a => a.id === id);
    if (exists) { console.log(`Alert "${id}" already exists.`); break; }
    data.alerts.push({
      id, symbol, name, condition,
      price: parseFloat(price),
      active: true, triggered: false, last_triggered: null
    });
    save(data);
    console.log(`✅ Alert added: ${name} ${condition} ${price} (id: ${id})`);
    break;
  }

  case 'remove': {
    const { id } = opts;
    if (!id) { console.error('Usage: manage-alerts.js remove --id ALERT_ID'); process.exit(1); }
    const data = load();
    const before = data.alerts.length;
    data.alerts = data.alerts.filter(a => a.id !== id);
    if (data.alerts.length === before) { console.warn(`No alert found with id "${id}"`); break; }
    save(data);
    console.log(`✅ Alert removed: ${id}`);
    break;
  }

  case 'list': {
    const data = load();
    if (data.alerts.length === 0) { console.log('No alerts configured.'); break; }
    console.log('\n📋 Active Alerts:\n');
    for (const a of data.alerts) {
      const status = a.triggered ? '✅ TRIGGERED' : a.active ? '🟢 ACTIVE' : '⚫ INACTIVE';
      console.log(`  [${status}] ${a.name} (${a.symbol})`);
      console.log(`           Condition: ${a.condition} ₹${a.price}  |  ID: ${a.id}`);
      if (a.last_triggered) console.log(`           Last triggered: ${a.last_triggered}`);
    }
    console.log();
    break;
  }

  case 'clear-triggered': {
    const data = load();
    data.alerts.forEach(a => { a.triggered = false; });
    save(data);
    console.log('✅ All triggered flags cleared. Alerts are active again.');
    break;
  }

  default:
    console.log('Commands: add | remove | list | clear-triggered');
    process.exit(1);
}
