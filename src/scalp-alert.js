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
  // Indices
  'NIFTY':     { tv: 'NSE:NIFTY',          name: 'Nifty 50',          unit: '₹', dp: 2 },
  'BANKNIFTY': { tv: 'NSE:BANKNIFTY',      name: 'Bank Nifty',        unit: '₹', dp: 2 },
  'SENSEX':    { tv: 'BSE:SENSEX',         name: 'Sensex',            unit: '₹', dp: 2 },
  'GIFTNIFTY': { tv: 'NSE:GIFTNIFTY',      name: 'Gift Nifty',        unit: '₹', dp: 2 },
  // Metals
  'XAUUSD':   { tv: 'TVC:GOLD',            name: 'XAU/USD (Gold)',    unit: '$', dp: 2 },
  'GOLD':     { tv: 'TVC:GOLD',            name: 'XAU/USD (Gold)',    unit: '$', dp: 2 },
  'SILVER':   { tv: 'TVC:SILVER',          name: 'XAG/USD (Silver)',  unit: '$', dp: 3 },
  // Crypto
  'BTCUSD':   { tv: 'BITSTAMP:BTCUSD',     name: 'BTC/USD (Bitcoin)', unit: '$', dp: 2 },
  'ETHUSD':   { tv: 'BITSTAMP:ETHUSD',     name: 'ETH/USD (Ethereum)',unit: '$', dp: 2 },
  // Energy
  'CRUDE':    { tv: 'TVC:USOIL',           name: 'Crude Oil (WTI)',   unit: '$', dp: 2 },
  // Forex — majors
  'EURUSD':   { tv: 'FX:EURUSD',           name: 'EUR/USD',           unit: '',  dp: 5 },
  'GBPUSD':   { tv: 'FX:GBPUSD',           name: 'GBP/USD',           unit: '',  dp: 5 },
  'USDJPY':   { tv: 'FX:USDJPY',           name: 'USD/JPY',           unit: '',  dp: 3 },
  'AUDUSD':   { tv: 'FX:AUDUSD',           name: 'AUD/USD',           unit: '',  dp: 5 },
  'USDCAD':   { tv: 'FX:USDCAD',           name: 'USD/CAD',           unit: '',  dp: 5 },
  'USDCHF':   { tv: 'FX:USDCHF',           name: 'USD/CHF',           unit: '',  dp: 5 },
  'NZDUSD':   { tv: 'FX:NZDUSD',           name: 'NZD/USD',           unit: '',  dp: 5 },
  'USDINR':   { tv: 'FX_IDC:USDINR',       name: 'USD/INR',           unit: '₹', dp: 4 },
  // Forex — crosses
  'GBPJPY':   { tv: 'FX:GBPJPY',           name: 'GBP/JPY',           unit: '',  dp: 3 },
  'EURJPY':   { tv: 'FX:EURJPY',           name: 'EUR/JPY',           unit: '',  dp: 3 },
  'GBPAUD':   { tv: 'FX:GBPAUD',           name: 'GBP/AUD',           unit: '',  dp: 5 },
  'EURGBP':   { tv: 'FX:EURGBP',           name: 'EUR/GBP',           unit: '',  dp: 5 },
  'EURCAD':   { tv: 'FX:EURCAD',           name: 'EUR/CAD',           unit: '',  dp: 5 },
  'AUDCAD':   { tv: 'FX:AUDCAD',           name: 'AUD/CAD',           unit: '',  dp: 5 },
  'AUDNZD':   { tv: 'FX:AUDNZD',           name: 'AUD/NZD',           unit: '',  dp: 5 },
  'CADJPY':   { tv: 'FX:CADJPY',           name: 'CAD/JPY',           unit: '',  dp: 3 },
  'AUDJPY':   { tv: 'FX:AUDJPY',           name: 'AUD/JPY',           unit: '',  dp: 3 },
  // Top F&O Stocks
  'RELIANCE':  { tv: 'NSE:RELIANCE',       name: 'Reliance (RIL)',    unit: '₹', dp: 2 },
  'TCS':       { tv: 'NSE:TCS',            name: 'TCS',               unit: '₹', dp: 2 },
  'INFY':      { tv: 'NSE:INFY',           name: 'Infosys',           unit: '₹', dp: 2 },
  'HDFCBANK':  { tv: 'NSE:HDFCBANK',       name: 'HDFC Bank',         unit: '₹', dp: 2 },
  'ICICIBANK': { tv: 'NSE:ICICIBANK',      name: 'ICICI Bank',        unit: '₹', dp: 2 },
  'SBIN':      { tv: 'NSE:SBIN',           name: 'SBI',               unit: '₹', dp: 2 },
  'WIPRO':     { tv: 'NSE:WIPRO',          name: 'Wipro',             unit: '₹', dp: 2 },
  'AXISBANK':  { tv: 'NSE:AXISBANK',       name: 'Axis Bank',         unit: '₹', dp: 2 },
  'KOTAKBANK': { tv: 'NSE:KOTAKBANK',      name: 'Kotak Bank',        unit: '₹', dp: 2 },
  'BAJFINANCE':{ tv: 'NSE:BAJFINANCE',     name: 'Bajaj Finance',     unit: '₹', dp: 2 },
  'MARUTI':    { tv: 'NSE:MARUTI',         name: 'Maruti Suzuki',     unit: '₹', dp: 2 },
  'TATAMOTORS':{ tv: 'NSE:TATAMOTORS',     name: 'Tata Motors',       unit: '₹', dp: 2 },
  'ADANIENT':  { tv: 'NSE:ADANIENT',       name: 'Adani Enterprises', unit: '₹', dp: 2 },
  'BHARTIARTL':{ tv: 'NSE:BHARTIARTL',     name: 'Bharti Airtel',     unit: '₹', dp: 2 },
  'ONGC':      { tv: 'NSE:ONGC',           name: 'ONGC',              unit: '₹', dp: 2 },
  'NTPC':      { tv: 'NSE:NTPC',           name: 'NTPC',              unit: '₹', dp: 2 },
  'SUNPHARMA': { tv: 'NSE:SUNPHARMA',      name: 'Sun Pharma',        unit: '₹', dp: 2 },
  'TITAN':     { tv: 'NSE:TITAN',          name: 'Titan',             unit: '₹', dp: 2 },
  'ASIANPAINT':{ tv: 'NSE:ASIANPAINT',     name: 'Asian Paints',      unit: '₹', dp: 2 },
  'LT':        { tv: 'NSE:LT',             name: 'L&T',               unit: '₹', dp: 2 },
  'ZOMATO':    { tv: 'NSE:ZOMATO',         name: 'Zomato',            unit: '₹', dp: 2 },
  'IRCTC':     { tv: 'NSE:IRCTC',          name: 'IRCTC',             unit: '₹', dp: 2 },
};

function buildTextMessage(a, meta, opt) {
  const { direction, levels, confluence, snapshot } = a;
  const { entry, sl, target } = levels;
  const { close, change, rsi, vwap, atr } = snapshot;
  const u   = meta.unit;
  const dp  = meta.dp;
  const f   = v => u + Number(v).toFixed(dp);
  const chg = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
  const now = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit'
  });

  const isLong    = direction === 'LONG';
  const dirLabel  = isLong ? '🟢 BUY' : '🔴 SELL';
  const confEmoji = { 'A+ SETUP':'🔥', 'A SETUP':'✅', 'B SETUP':'⚠️', 'AVOID':'⛔' }[confluence.quality] || '✅';
  const rsiLabel  = rsi < 35 ? 'Oversold' : rsi > 65 ? 'Overbought' : 'Neutral';

  let optBlock = '';
  if (opt) {
    optBlock = `\n*Options:* ${opt.recommendedStrike} ${opt.optionType} | Exp: ${opt.expiry.label} (${opt.expiry.daysLeft}d) | Lot: ${opt.lotSize}\n_Est P&L: +₹${opt.lotGain.toLocaleString('en-IN')} / -₹${opt.lotLoss.toLocaleString('en-IN')} per lot_\n`;
  }

  return `${confEmoji} *${meta.name}* — ${dirLabel}
_${now} IST_

*Price*
Current  ${f(close)}  (${chg})
Range    ${f(snapshot.low)} – ${f(snapshot.high)}

*Trade Levels*
Entry   →  ${f(entry)}
Target  →  ${f(target)}  _(+${Math.abs(target-entry).toFixed(0)} pts)_
SL      →  ${f(sl)}  _(-${Math.abs(sl-entry).toFixed(0)} pts)_
RR      →  1 : 2.5
${optBlock}
*Indicators*
RSI ${rsi.toFixed(1)} (${rsiLabel})  |  VWAP ${close > vwap ? 'Above ✅' : 'Below 🔴'}  |  ATR ${f(atr)}

*Signal*  ${confEmoji} ${confluence.quality}  (${confluence.score}/5)
_⚠️ Always verify before entry. Not financial advice._`;
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
    if (!symbolArg) process.exit(1);
    return { error: 'Price fetch failed: ' + err.message };
  }

  const raw = prices[meta.tv];
  if (!raw) {
    log.error('No data returned for ' + meta.tv);
    if (!symbolArg) process.exit(1);
    return { error: `No price data for ${arg}. Symbol may be temporarily unavailable.` };
  }

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
