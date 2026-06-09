#!/usr/bin/env node
// Morning Briefing — runs at 7:30 AM IST daily
// Fetches Dollar, Crude, Gold, Silver, GiftNifty, Nifty50, BTCUSD → WhatsApp

const { fetchPrices, arrow, fmt } = require('./tradingview');
const { sendWhatsApp } = require('./whatsapp');
const { getTodayEvents, formatEvents } = require('./economic-calendar');
const log = require('./logger');
const settings = require('../config/settings.json');

const SYMBOLS = settings.morning_briefing.symbols;

function formatLine(meta, data) {
  if (!data) return `${meta.emoji} *${meta.label}*  N/A`;
  const chg = data.change != null
    ? (data.change >= 0 ? '+' : '') + data.change.toFixed(2) + '%'
    : 'N/A';
  const ind = arrow(data.change);
  return `${meta.emoji} *${meta.label}*  ${meta.unit}${fmt(data.close)}  ${ind} ${chg}`;
}

async function run() {
  log.info('Morning briefing started...');
  const symbolKeys = Object.keys(SYMBOLS);
  const tvSymbols  = symbolKeys.map(k => SYMBOLS[k].symbol);

  // Fetch prices + economic events in parallel
  const [prices, events] = await Promise.all([
    fetchPrices(tvSymbols).catch(err => {
      log.error('Briefing fetch failed: ' + err.message);
      return {};
    }),
    getTodayEvents()
  ]);

  const now = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  const lines = symbolKeys.map(k => {
    const meta = SYMBOLS[k];
    const data = prices[meta.symbol];
    return formatLine(meta, data);
  });

  // Market mood from Nifty
  const niftyData = prices[SYMBOLS.NIFTY50.symbol];
  let mood = '🟡 Neutral';
  if (niftyData) {
    if (niftyData.change > 0.5)       mood = '🟢 Bullish — Buy dips';
    else if (niftyData.change < -0.5) mood = '🔴 Bearish — Sell rallies';
  }

  // Economic events section
  const eventsText = formatEvents(events);

  const message =
    `🌅 *Good Morning!*\n_${now}_\n\n` +
    lines.join('\n') + '\n\n' +
    `*Mood:* ${mood}\n` +
    (eventsText
      ? `\n📅 *Today\'s Key Events*\n${eventsText}\n`
      : '') +
    `\n_Data: TradingView · ForexFactory · ATLAS PRO_`;

  log.info('Sending morning briefing...');
  const ok = await sendWhatsApp(message);
  if (ok) log.info('Morning briefing sent ✅');
  else    log.error('Morning briefing failed ❌');
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch(err => { log.error(err.message); process.exit(1); });
}

module.exports = { run };
