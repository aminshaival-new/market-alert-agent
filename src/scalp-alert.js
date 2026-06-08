#!/usr/bin/env node
// Scalping Trade Alert — generates chart + analysis → sends to WhatsApp
// Usage: node src/scalp-alert.js XAUUSD
//        node src/scalp-alert.js NIFTY
//        node src/scalp-alert.js BTCUSD

const { fetchPrices, fmt } = require('./tradingview');
const { analyze }          = require('./trade-analyzer');
const { generateTradeChart } = require('./chart-generator');
const { sendWhatsApp, sendWhatsAppImage } = require('./whatsapp');
const { getOptionRecommendation } = require('./options-helper');
const log                  = require('./logger');

const OPTIONS_SYMBOLS = ['NIFTY', 'BANKNIFTY', 'SENSEX'];

// Symbol aliases → TradingView symbols
const SYMBOL_MAP = {
  'XAUUSD':   { tv: 'TVC:GOLD',          name: 'XAU/USD (Gold)',    unit: '$',  dp: 2 },
  'GOLD':     { tv: 'TVC:GOLD',          name: 'XAU/USD (Gold)',    unit: '$',  dp: 2 },
  'NIFTY':    { tv: 'NSE:NIFTY',         name: 'Nifty 50',          unit: '₹',  dp: 2 },
  'BTCUSD':   { tv: 'BITSTAMP:BTCUSD',   name: 'BTC/USD (Bitcoin)', unit: '$',  dp: 2 },
  'BANKNIFTY':{ tv: 'NSE:BANKNIFTY',     name: 'Bank Nifty',        unit: '₹',  dp: 2 },
  'EURUSD':   { tv: 'FX:EURUSD',         name: 'EUR/USD',           unit: '',   dp: 5 },
  'USDINR':   { tv: 'FX_IDC:USDINR',     name: 'USD/INR',           unit: '₹',  dp: 4 },
  'CRUDE':    { tv: 'TVC:USOIL',         name: 'Crude Oil (WTI)',   unit: '$',  dp: 2 },
  'SILVER':   { tv: 'TVC:SILVER',        name: 'XAG/USD (Silver)',  unit: '$',  dp: 3 },
  'RELIANCE': { tv: 'NSE:RELIANCE',      name: 'Reliance (RIL)',    unit: '₹',  dp: 2 },
};

function buildTextMessage(a, meta, opt) {
  const { direction, trend, phase, levels, confluence, warning, snapshot } = a;
  const { entry, sl, target } = levels;
  const { close, change, rsi, vwap, atr } = snapshot;
  const u   = meta.unit;
  const dp  = meta.dp;
  const f   = v => u + Number(v).toFixed(dp);
  const chg = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata',
    weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });

  const arrow     = direction === 'LONG' ? '▲' : '▼';
  const confEmoji = { 'A+ SETUP':'🔥', 'A SETUP':'✅', 'B SETUP':'⚠️', 'AVOID':'⛔' }[confluence.quality] || '';

  // Build options block if available
  let optionsBlock = '';
  if (opt) {
    optionsBlock = `
━━━━━━━━━━━━━━━━━━━━
🎰 *OPTIONS TRADE*
━━━━━━━━━━━━━━━━━━━━
📌 Strike : *${opt.recommendedStrike} ${opt.optionType}*
📅 Expiry : ${opt.expiry.label} (${opt.expiry.daysLeft}d left | ${opt.expiry.dayName})
📦 Lot Size : ${opt.lotSize} units

🎯 Strike Note:
  ${opt.strikeNote}

📈 Est. Premium Impact (delta ~0.45):
  • If target hit → +${opt.estPremiumGain} pts/unit → +₹${opt.lotGain.toLocaleString('en-IN')}/lot
  • If SL hit     → -${opt.estPremiumLoss} pts/unit → -₹${opt.lotLoss.toLocaleString('en-IN')}/lot

⚡ Verify live premium on Zerodha / Upstox before entry.
`;
  }

  return (
`━━━━━━━━━━━━━━━━━━━━
📊 *${meta.name} SCALP SETUP*
🕐 ${now}
━━━━━━━━━━━━━━━━━━━━

💰 *Nifty Spot:* ${f(close)} (${chg})
📈 *Day Range:* ${f(snapshot.low)} – ${f(snapshot.high)}

━━━━━━━━━━━━━━━━━━━━
${arrow} *TRADE: ${direction}* | RR 1:${levels.rr}
━━━━━━━━━━━━━━━━━━━━

🎯 Index Entry  : ${f(entry)}
✅ Index Target : ${f(target)}  (${Math.abs(target-entry).toFixed(0)} pts)
🛑 Index SL     : ${f(sl)}  (${Math.abs(sl-entry).toFixed(0)} pts)
${optionsBlock}
━━━━━━━━━━━━━━━━━━━━
📡 *INDICATORS*
• RSI (14)  : ${rsi.toFixed(1)} ${rsi < 35 ? '⚡ Oversold' : rsi > 65 ? '🚫 Overbought' : '✅ Neutral'}
• VWAP      : ${f(vwap)} ${close > vwap ? '(above ✅)' : '(below 🔴)'}
• ATR       : ${f(atr)}
• Trend     : ${trend.emoji} ${trend.label}
• Phase     : ${phase.emoji} ${phase.phase}

━━━━━━━━━━━━━━━━━━━━
${confEmoji} *SETUP: ${confluence.quality}* (${confluence.score}/5)
${confluence.factors.map(x => '  • ' + x).join('\n')}

${warning}
━━━━━━━━━━━━━━━━━━━━
_ATLAS — 25yr Trader AI by Claude_`
  );
}

async function run(symbolArg) {
  const arg    = (symbolArg || process.argv[2] || 'XAUUSD').toUpperCase();
  const meta   = SYMBOL_MAP[arg];
  if (!meta) {
    console.error(`Unknown symbol: ${arg}\nAvailable: ${Object.keys(SYMBOL_MAP).join(', ')}`);
    if (!symbolArg) process.exit(1);
    return { error: `Unknown symbol: ${arg}. Try: ${Object.keys(SYMBOL_MAP).join(', ')}` };
  }

  log.info(`Scalp analysis requested: ${arg} (${meta.tv})`);

  // 1. Fetch live data
  let prices;
  try {
    prices = await fetchPrices([meta.tv]);
  } catch (err) {
    log.error('Price fetch failed: ' + err.message);
    process.exit(1);
  }

  const raw = prices[meta.tv];
  if (!raw) { log.error('No data returned for ' + meta.tv); process.exit(1); }

  // Fetch with technical indicators separately (global scanner may not have all)
  const techBody = {
    symbols: { tickers: [meta.tv], query: { types: [] } },
    columns: ['close','open','high','low','change','RSI','EMA10','SMA50','ATR','VWAP']
  };
  let techData = {};
  try {
    const res  = await fetch('https://scanner.tradingview.com/global/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify(techBody)
    });
    const json = await res.json();
    if (json.data && json.data[0]) {
      const [close, open, high, low, change, rsi, ema10, sma50, atr, vwap] = json.data[0].d;
      techData = { close, open, high, low, change, rsi, ema10, sma50, atr, vwap };
    }
  } catch (e) { /* fall back to raw */ }

  const priceData = Object.keys(techData).length ? techData : raw;

  // 2. Analyze
  const analysis = analyze(priceData, meta.name);

  // 3. Generate chart
  log.info('Generating chart...');
  let chartUrl = null;
  try {
    chartUrl = await generateTradeChart(analysis);
    log.info('Chart URL: ' + chartUrl);
  } catch (err) {
    log.error('Chart generation failed: ' + err.message);
  }

  // 4. Options data (only for index options)
  let opt = null;
  if (OPTIONS_SYMBOLS.includes(arg)) {
    opt = getOptionRecommendation(analysis, arg);
    if (opt) log.info(`Options: ${opt.recommendedStrike} ${opt.optionType} | Expiry: ${opt.expiry.label} | Lot: ${opt.lotSize}`);
  }

  // 5. Build message
  const textMsg = buildTextMessage(analysis, meta, opt);

  // 5. Send to WhatsApp
  if (chartUrl) {
    // Send chart image with short caption first
    const shortCaption = `${analysis.direction === 'LONG' ? '▲' : '▼'} ${meta.name} SCALP | Entry: ${meta.unit}${Number(analysis.levels.entry).toFixed(meta.dp)} | Target: ${meta.unit}${Number(analysis.levels.target).toFixed(meta.dp)} | SL: ${meta.unit}${Number(analysis.levels.sl).toFixed(meta.dp)}`;
    await sendWhatsAppImage(chartUrl, shortCaption);
    // Then send full text analysis
    await new Promise(r => setTimeout(r, 1500));
    await sendWhatsApp(textMsg);
  } else {
    await sendWhatsApp(textMsg);
  }

  log.info('Scalp alert sent for ' + arg);
  if (!symbolArg) setTimeout(() => process.exit(0), 200);
  return { success: true, symbol: arg };
}

// Only auto-run when called directly from CLI
if (require.main === module) {
  run().catch(err => { console.error(err); setTimeout(() => process.exit(1), 200); });
}

module.exports = { run, SYMBOL_MAP };
