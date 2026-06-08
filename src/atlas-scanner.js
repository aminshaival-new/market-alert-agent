#!/usr/bin/env node
// ATLAS PRO Scanner — scans F&O stocks + Crypto + Forex + Metals + Crude
// Sends WhatsApp alert with all signals scored 3+/5 (only quality setups)
// Runs on GitHub Actions: 9:30 AM, 12:00 PM, 2:00 PM IST on market days

const { FO_STOCKS, MULTI_ASSET }    = require('./fo-stocks');
const { analyze }                    = require('./strategy-engine');
const { generateTradeChart }         = require('./chart-generator');
const { sendWhatsApp, sendWhatsAppImage } = require('./whatsapp');
const { getOptionRecommendation }    = require('./options-helper');
const log                            = require('./logger');

const TV_COLUMNS = [
  'close','open','high','low','change','RSI','EMA10','SMA50','ATR','ADX',
  'VWAP','Recommend.MA','Recommend.Other','volume'
];

// ── Fetch prices for a batch of symbols ──────────────────────────────────────
async function fetchBatch(symbols, market = 'global') {
  const endpoint = `https://scanner.tradingview.com/${market}/scan`;
  const body = {
    symbols: { tickers: symbols, query: { types: [] } },
    columns: TV_COLUMNS
  };
  const res  = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`TV API ${res.status} for ${market}`);
  const json = await res.json();
  const out  = {};
  for (const item of (json.data || [])) {
    const [close,open,high,low,change,rsi,ema10,sma50,atr,adx,vwap,recMA,recOsc,volume] = item.d;
    out[item.s] = { close,open,high,low,change,rsi,ema10,sma50,atr,adx,vwap,recMA,recOsc,volume };
  }
  return out;
}

// ── Chunk array ───────────────────────────────────────────────────────────────
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Format a single signal line ───────────────────────────────────────────────
function fmtSignal(result, unit = '₹', dp = 2) {
  const { symbolName, direction, score, label, levels, snapshot } = result;
  const { entry, sl, target } = levels;
  const f   = v => unit + Number(v).toFixed(dp);
  const chg = (snapshot.change >= 0 ? '+' : '') + snapshot.change.toFixed(2) + '%';
  const arr = direction === 'LONG' ? '▲' : '▼';
  return `${label.emoji} ${arr} *${symbolName}* (${chg})\n` +
         `   Entry ${f(entry)} | SL ${f(sl)} | TGT ${f(target)} | RR 1:2.5`;
}

// ── Options line for F&O stocks ───────────────────────────────────────────────
function fmtOptions(result, symbolKey) {
  const isIndex = ['NIFTY','BANKNIFTY','SENSEX'].includes(symbolKey);
  let opt;
  if (isIndex) {
    opt = getOptionRecommendation(result, symbolKey);
  } else {
    // Stock options: nearest monthly expiry (last Thursday of current month)
    const { direction, levels, snapshot } = result;
    const { entry, sl, target } = levels;
    const close = snapshot.close;
    const step  = close < 500 ? 5 : close < 2000 ? 50 : close < 5000 ? 100 : 500;
    const atm   = Math.round(close / step) * step;

    // Last Thursday of current month
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    while (lastDay.getDay() !== 4) lastDay.setDate(lastDay.getDate() - 1);
    const expiryLabel = lastDay.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric', weekday:'short', timeZone:'Asia/Kolkata' });
    const daysLeft = Math.ceil((lastDay - now) / 86400000);

    const optType = direction === 'LONG' ? 'CE' : 'PE';
    const lotSize = 1; // stock options vary; show strike only
    const delta   = 0.45;
    const estGain = Math.round(Math.abs(target - entry) * delta);
    const estLoss = Math.round(Math.abs(sl - entry) * delta);

    opt = {
      recommendedStrike: atm,
      optionType: optType,
      strikeNote: `ATM ${atm} ${optType}`,
      expiry: { label: expiryLabel, daysLeft },
      lotSize,
      estPremiumGain: estGain,
      estPremiumLoss: estLoss,
      lotGain: estGain,
      lotLoss: estLoss,
      isStock: true
    };
  }
  if (!opt) return '';
  return `   📌 ${opt.recommendedStrike} ${opt.optionType} | Exp: ${opt.expiry.label} (${opt.expiry.daysLeft}d)`;
}

// ── Scan F&O stocks ───────────────────────────────────────────────────────────
async function scanFO() {
  log.info('Scanning F&O stocks...');
  const signals = { LONG: [], SHORT: [] };
  const batches = chunk(FO_STOCKS, 20);

  for (const batch of batches) {
    let prices = {};
    try { prices = await fetchBatch(batch, 'india'); } catch (e) {
      try { prices = await fetchBatch(batch, 'global'); } catch (e2) {
        log.error('F&O batch fetch failed: ' + e2.message); continue;
      }
    }
    for (const sym of batch) {
      const d = prices[sym];
      if (!d || !d.close) continue;
      const shortName = sym.replace('NSE:', '');
      const result = analyze(d, shortName);
      if (result.score >= 4) signals[result.direction].push({ ...result, sym, unit: '₹', dp: 2 });
    }
    await new Promise(r => setTimeout(r, 300)); // rate limit
  }
  return signals;
}

// ── Scan multi-asset (crypto, forex, metals, crude) ───────────────────────────
async function scanMultiAsset() {
  const allSymbols = Object.values(MULTI_ASSET).flat().map(a => a.symbol);
  let prices = {};
  try { prices = await fetchBatch(allSymbols, 'global'); } catch (e) {
    log.error('Multi-asset fetch failed: ' + e.message);
    return {};
  }

  const results = {};
  for (const [assetClass, assets] of Object.entries(MULTI_ASSET)) {
    results[assetClass] = [];
    for (const asset of assets) {
      const d = prices[asset.symbol];
      if (!d || !d.close) continue;
      const result = analyze(d, asset.name);
      if (result.score >= 3) {
        results[assetClass].push({ ...result, asset, unit: asset.unit, dp: asset.symbol.includes('INR') ? 4 : 2 });
      }
    }
  }
  return results;
}

// ── Build WhatsApp message ─────────────────────────────────────────────────────
function buildMessage(foSignals, multiAsset, scanTime) {
  const totalFO   = foSignals.LONG.length + foSignals.SHORT.length;
  const totalOther = Object.values(multiAsset).flat().length;

  let msg = `━━━━━━━━━━━━━━━━━━━━\n`;
  msg    += `🔥 *ATLAS PRO SCANNER*\n`;
  msg    += `🕐 ${scanTime} IST\n`;
  msg    += `📊 ${totalFO} F&O + ${totalOther} Multi-Asset signals\n`;
  msg    += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  // ── F&O Stocks ──────────────────────────────────────────────────────────────
  if (foSignals.LONG.length > 0) {
    msg += `📈 *F&O BUY (CE) SETUPS* (${foSignals.LONG.length})\n`;
    for (const r of foSignals.LONG.slice(0, 8)) {
      msg += fmtSignal(r, '₹', 2) + '\n';
      msg += fmtOptions(r, r.sym?.replace('NSE:','')) + '\n\n';
    }
  }

  if (foSignals.SHORT.length > 0) {
    msg += `📉 *F&O SELL (PE) SETUPS* (${foSignals.SHORT.length})\n`;
    for (const r of foSignals.SHORT.slice(0, 8)) {
      msg += fmtSignal(r, '₹', 2) + '\n';
      msg += fmtOptions(r, r.sym?.replace('NSE:','')) + '\n\n';
    }
  }

  if (totalFO === 0) msg += `📋 No F&O setups above threshold right now.\n\n`;

  // ── Multi-asset ─────────────────────────────────────────────────────────────
  const assetEmojis = { CRYPTO:'₿', FOREX:'💱', METALS:'🏅', CRUDE:'🛢️' };
  const assetLabels = { CRYPTO:'CRYPTO', FOREX:'FOREX', METALS:'METALS', CRUDE:'CRUDE OIL' };

  for (const [cls, signals] of Object.entries(multiAsset)) {
    if (signals.length === 0) continue;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `${assetEmojis[cls]} *${assetLabels[cls]}*\n`;
    for (const r of signals) {
      const dp = r.dp || 2;
      msg += fmtSignal(r, r.unit, dp) + '\n';
      msg += `   RSI: ${r.snapshot.rsi?.toFixed(1)} | ADX: ${r.snapshot.adx?.toFixed(1)} | ${r.label.quality} (${r.score}/5)\n\n`;
    }
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `⚡ *Strategy:* QUAD CONFLUENCE | Min Score: 4/5\n`;
  msg += `📐 *RR:* 1:2.5 | *SL:* 0.4×ATR | *Target:* 1×ATR\n`;
  msg += `⚠️ Always verify with broker before entry.\n`;
  msg += `_ATLAS PRO by Claude_`;

  return msg;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  const scanTime = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', weekday:'short', day:'2-digit', month:'short',
    hour:'2-digit', minute:'2-digit'
  });

  log.info(`ATLAS PRO scan started at ${scanTime}`);

  const [foSignals, multiAsset] = await Promise.all([scanFO(), scanMultiAsset()]);

  const totalSignals = foSignals.LONG.length + foSignals.SHORT.length +
    Object.values(multiAsset).flat().length;

  log.info(`Scan complete — ${totalSignals} quality signals found`);

  if (totalSignals === 0) {
    log.info('No quality setups — skipping WhatsApp (silent mode)');
    // No message sent when there are no signals (saves messages + avoids noise)
    if (require.main === module) setTimeout(() => process.exit(0), 200);
    return { signals: 0 };
  }

  // Try to generate chart for top signal
  let chartUrl = null;
  const topSignal = [...foSignals.LONG, ...foSignals.SHORT].sort((a,b) => b.score - a.score)[0]
    || Object.values(multiAsset).flat().sort((a,b) => b.score - a.score)[0];

  if (topSignal) {
    try {
      // Build analysis object compatible with chart-generator
      const chartAnalysis = {
        symbol: topSignal.symbolName,
        direction: topSignal.direction,
        levels: topSignal.levels,
        phase: { emoji: topSignal.label.emoji, phase: topSignal.label.quality },
        confluence: { quality: topSignal.label.quality, score: topSignal.score },
        snapshot: { ...topSignal.snapshot, rsi: topSignal.snapshot.rsi }
      };
      chartUrl = await generateTradeChart(chartAnalysis);
      log.info('Top signal chart: ' + chartUrl);
    } catch (e) {
      log.error('Chart gen failed: ' + e.message);
    }
  }

  const msg = buildMessage(foSignals, multiAsset, scanTime);

  if (chartUrl) {
    const caption = `${topSignal.label.emoji} Top Signal: ${topSignal.symbolName} ${topSignal.direction} | Score ${topSignal.score}/5`;
    await sendWhatsAppImage(chartUrl, caption);
    await new Promise(r => setTimeout(r, 1500));
  }
  await sendWhatsApp(msg);

  log.info('ATLAS PRO scan alert sent.');
  if (require.main === module) setTimeout(() => process.exit(0), 300);
  return { signals: totalSignals };
}

if (require.main === module) {
  run().catch(err => { log.error(err.message); setTimeout(() => process.exit(1), 200); });
}

module.exports = { run };
