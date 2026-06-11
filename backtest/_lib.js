#!/usr/bin/env node
// ATLAS PRO — Local backtest + grid optimizer for the Killshot strategy
// Mirrors pine-scripts v5 logic. Data: Binance (BTC 15m) + Yahoo (Gold 15m)
// Usage: node backtest/backtest.js [gold|btc|both]

const fs = require('fs');
const path = require('path');
const CACHE = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true });

// ── Data fetchers ─────────────────────────────────────────────
async function fetchBinance(symbol = 'BTCUSDT', interval = '15m', days = 180) {
  const file = path.join(CACHE, `${symbol}-${interval}-${days}d.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const bars = [];
  let endTime = Date.now();
  const target = Date.now() - days * 86400000;
  while (endTime > target) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=1000&endTime=${endTime}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance ${res.status}`);
    const data = await res.json();
    if (!data.length) break;
    for (const k of data) bars.push({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] });
    endTime = data[0][0] - 1;
    await new Promise(r => setTimeout(r, 250));
  }
  bars.sort((a, b) => a.t - b.t);
  const uniq = bars.filter((b, i) => i === 0 || b.t !== bars[i - 1].t);
  fs.writeFileSync(file, JSON.stringify(uniq));
  return uniq;
}

async function fetchYahoo(ticker = 'GC=F', interval = '15m', range = '60d') {
  const file = path.join(CACHE, `${ticker.replace(/[^A-Za-z0-9]/g, '')}-${interval}-${range}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Yahoo ${res.status}`);
  const json = await res.json();
  const r = json.chart?.result?.[0];
  if (!r) throw new Error('Yahoo: no data');
  const ts = r.timestamp, q = r.indicators.quote[0];
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close[i] == null || q.open[i] == null) continue;
    bars.push({ t: ts[i] * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0 });
  }
  fs.writeFileSync(file, JSON.stringify(bars));
  return bars;
}

// ── Indicators (Wilder where Pine uses Wilder) ────────────────
function ema(src, len) {
  const out = new Array(src.length).fill(NaN);
  const k = 2 / (len + 1);
  let prev = src[0]; out[0] = prev;
  for (let i = 1; i < src.length; i++) { prev = src[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}
function rma(src, len) {
  const out = new Array(src.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    if (i < len) { sum += src[i]; out[i] = sum / (i + 1); }
    else out[i] = (out[i - 1] * (len - 1) + src[i]) / len;
  }
  return out;
}
function atrArr(bars, len) {
  const tr = bars.map((b, i) => i === 0 ? b.h - b.l :
    Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)));
  return rma(tr, len);
}
function rsiArr(closes, len) {
  const up = [], dn = [];
  for (let i = 0; i < closes.length; i++) {
    const ch = i === 0 ? 0 : closes[i] - closes[i - 1];
    up.push(Math.max(ch, 0)); dn.push(Math.max(-ch, 0));
  }
  const au = rma(up, len), ad = rma(dn, len);
  return closes.map((_, i) => ad[i] === 0 ? 100 : 100 - 100 / (1 + au[i] / ad[i]));
}
function adxArr(bars, len) {
  const plusDM = [0], minusDM = [0];
  for (let i = 1; i < bars.length; i++) {
    const upM = bars[i].h - bars[i - 1].h, dnM = bars[i - 1].l - bars[i].l;
    plusDM.push(upM > dnM && upM > 0 ? upM : 0);
    minusDM.push(dnM > upM && dnM > 0 ? dnM : 0);
  }
  const atr = atrArr(bars, len);
  const pdi = rma(plusDM, len).map((v, i) => 100 * v / (atr[i] || 1));
  const mdi = rma(minusDM, len).map((v, i) => 100 * v / (atr[i] || 1));
  const dx = pdi.map((p, i) => { const s = p + mdi[i]; return s === 0 ? 0 : 100 * Math.abs(p - mdi[i]) / s; });
  return rma(dx, len);
}

// HTF (1h) EMA computed from 15m bars; value = last COMPLETED hour
function htfEmaSeries(bars, len) {
  const hourly = [];   // {endIdx, close}
  let curHour = -1;
  for (let i = 0; i < bars.length; i++) {
    const hr = Math.floor(bars[i].t / 3600000);
    if (hr !== curHour) { if (curHour !== -1) hourly[hourly.length - 1].endIdx = i - 1; hourly.push({ endIdx: i, close: bars[i].c }); curHour = hr; }
    else hourly[hourly.length - 1].close = bars[i].c, hourly[hourly.length - 1].endIdx = i;
  }
  const hCloses = hourly.map(h => h.close);
  const hEma = ema(hCloses, len);
  // map each 15m bar -> ema/close of last completed hourly bar
  const outEma = new Array(bars.length).fill(NaN);
  const outClose = new Array(bars.length).fill(NaN);
  let hIdx = 0;
  for (let i = 0; i < bars.length; i++) {
    while (hIdx < hourly.length - 1 && hourly[hIdx].endIdx < i) hIdx++;
    const completed = hourly[hIdx].endIdx <= i ? hIdx - 1 : hIdx - 1; // last completed = previous hour
    if (completed >= 0) { outEma[i] = hEma[completed]; outClose[i] = hCloses[completed]; }
  }
  return { ema: outEma, close: outClose };
}

// ── Strategy simulation (mirrors Killshot v5) ─────────────────
function simulate(bars, p) {
  const closes = bars.map(b => b.c);
  const emaF = ema(closes, 9), emaM = ema(closes, 21), emaS = ema(closes, 50);
  const atr = atrArr(bars, 14), rsi = rsiArr(closes, 14), adx = adxArr(bars, 14);
  const htf = htfEmaSeries(bars, 50);
  const vol20 = rma(bars.map(b => b.v), 20);

  const trades = [];
  let pos = null;          // {dir, entry, sl, tp1, tp2, half, be, setup, entryIdx}
  let lastSigBar = -9999;

  for (let i = 60; i < bars.length; i++) {
    const b = bars[i];

    // manage open position first (on this bar's range)
    if (pos) {
      const done = (exitPx, half2) => {
        const r1 = pos.dir * (pos.tp1 - pos.entry);
        const r2 = pos.dir * (exitPx - pos.entry);
        const gross = pos.half ? 0.5 * r1 + 0.5 * r2 : r2;
        trades.push({ pnl: gross - p.cost, setup: pos.setup, bars: i - pos.entryIdx });
        pos = null;
      };
      if (pos.dir === 1) {
        if (b.l <= pos.sl) { done(Math.min(pos.sl, b.o)); }
        else {
          if (!pos.half && b.h >= pos.tp1) { pos.half = true; pos.sl = pos.entry; }
          if (pos && pos.half && b.h >= pos.tp2) done(pos.tp2);
        }
      } else {
        if (b.h >= pos.sl) { done(Math.max(pos.sl, b.o)); }
        else {
          if (!pos.half && b.l <= pos.tp1) { pos.half = true; pos.sl = pos.entry; }
          if (pos && pos.half && b.l <= pos.tp2) done(pos.tp2);
        }
      }
      if (pos) continue;     // still in trade — no new signals
    }

    // signal calculation at bar i
    if (i - lastSigBar < p.cooldown) continue;
    const a = atr[i]; if (!a || a <= 0) continue;
    if ((b.h - b.l) >= a * p.maxSpreadAtr) continue;

    // session filter (gold only): 07:00–21:00 UTC
    if (p.session) {
      const mins = new Date(b.t).getUTCHours() * 60 + new Date(b.t).getUTCMinutes();
      if (mins < 420 || mins > 1260) continue;
    }
    // volume filter
    const volOK = !p.useVol || !vol20[i] || vol20[i] <= 0 || b.v > vol20[i] * 1.15;
    if (!volOK) continue;

    const htfBull = htf.close[i] > htf.ema[i], htfBear = htf.close[i] < htf.ema[i];
    const trending = adx[i] >= p.adxMin;
    const sep = Math.abs(emaM[i] - emaS[i]) >= a * p.minSep;
    const slopeUp = emaM[i] > emaM[i - 3], slopeDown = emaM[i] < emaM[i - 3];
    const bullStack = emaF[i] > emaM[i] && emaM[i] > emaS[i] && b.c > emaS[i] && sep && slopeUp;
    const bearStack = emaF[i] < emaM[i] && emaM[i] < emaS[i] && b.c < emaS[i] && sep && slopeDown;

    // pullback
    const pbLong = p.usePullback && bullStack && htfBull && trending &&
      b.l <= emaM[i] && b.c > emaM[i] && b.c > b.o && b.c > emaF[i] && rsi[i] > 45 && rsi[i] < 70;
    const pbShort = p.usePullback && bearStack && htfBear && trending &&
      b.h >= emaM[i] && b.c < emaM[i] && b.c < b.o && b.c < emaF[i] && rsi[i] < 55 && rsi[i] > 30;

    // sweep
    let swLow = Infinity, swHigh = -Infinity;
    for (let j = i - 20; j < i; j++) { swLow = Math.min(swLow, bars[j].l); swHigh = Math.max(swHigh, bars[j].h); }
    const range = b.h - b.l;
    const lowerW = Math.min(b.o, b.c) - b.l, upperW = b.h - Math.max(b.o, b.c);
    const swpLong = p.useSweep && htfBull && trending && b.l < swLow && b.c > swLow &&
      (swLow - b.l) >= a * p.minPierce && range > 0 && lowerW / range >= p.wickRatio && b.c > b.o && rsi[i] < 60;
    const swpShort = p.useSweep && htfBear && trending && b.h > swHigh && b.c < swHigh &&
      (b.h - swHigh) >= a * p.minPierce && range > 0 && upperW / range >= p.wickRatio && b.c < b.o && rsi[i] > 40;

    const longSig = pbLong || swpLong, shortSig = pbShort || swpShort;
    if (!longSig && !shortSig) continue;

    // anti-hunt stop
    let lo8 = Infinity, hi8 = -Infinity;
    for (let j = i - p.huntBars + 1; j <= i; j++) { lo8 = Math.min(lo8, bars[j].l); hi8 = Math.max(hi8, bars[j].h); }

    if (longSig) {
      const sl = lo8 - a * p.slBuf, risk = b.c - sl;
      if (risk > a * 0.3) {
        pos = { dir: 1, entry: b.c, sl, tp1: b.c + risk * p.tp1R, tp2: b.c + risk * p.tp2R, half: false, setup: swpLong ? 'sweep' : 'pullback', entryIdx: i };
        lastSigBar = i;
      }
    } else if (shortSig) {
      const sl = hi8 + a * p.slBuf, risk = sl - b.c;
      if (risk > a * 0.3) {
        pos = { dir: -1, entry: b.c, sl, tp1: b.c - risk * p.tp1R, tp2: b.c - risk * p.tp2R, half: false, setup: swpShort ? 'sweep' : 'pullback', entryIdx: i };
        lastSigBar = i;
      }
    }
  }

  // stats
  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl <= 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  let cum = 0, peak = 0, maxDD = 0;
  for (const t of trades) { cum += t.pnl; peak = Math.max(peak, cum); maxDD = Math.max(maxDD, peak - cum); }
  const bySetup = {};
  for (const s of ['pullback', 'sweep']) {
    const st = trades.filter(t => t.setup === s);
    const sw = st.filter(t => t.pnl > 0);
    bySetup[s] = { n: st.length, wr: st.length ? (sw.length / st.length * 100).toFixed(0) : '-', pnl: st.reduce((x, t) => x + t.pnl, 0).toFixed(1) };
  }
  return {
    n: trades.length,
    wr: trades.length ? +(wins.length / trades.length * 100).toFixed(1) : 0,
    pf: gl > 0 ? +(gw / gl).toFixed(2) : (gw > 0 ? 99 : 0),
    pnl: +cum.toFixed(1), maxDD: +maxDD.toFixed(1), bySetup
  };
}

// ── Grid search ───────────────────────────────────────────────
async function optimize(name, bars, baseCost, session) {
  console.log(`\n══════ ${name} — ${bars.length} bars (${new Date(bars[0].t).toISOString().slice(0,10)} → ${new Date(bars[bars.length-1].t).toISOString().slice(0,10)}) ══════`);
  const grid = [];
  for (const adxMin of [18, 21, 24, 28])
    for (const slBuf of [0.4, 0.6, 0.9])
      for (const tp1R of [1.0, 1.5])
        for (const tp2R of [2.0, 3.0])
          for (const setups of [['both', true, true], ['pb', true, false], ['swp', false, true]])
            grid.push({ adxMin, slBuf, tp1R, tp2R, setupName: setups[0], usePullback: setups[1], useSweep: setups[2] });

  const results = [];
  for (const g of grid) {
    const p = { ...g, cooldown: 10, maxSpreadAtr: 2.5, minSep: 0.25, minPierce: 0.3, wickRatio: 0.5, huntBars: 8, useVol: !session, session, cost: baseCost };
    const r = simulate(bars, p);
    if (r.n >= 15) results.push({ ...g, ...r });
  }
  results.sort((a, b) => b.pf - a.pf);

  console.log('TOP 12 CONFIGS (min 15 trades):');
  console.log('setup | ADX | slBuf | TP1R | TP2R | trades | WR%  | PF   | PnL(pts) | maxDD');
  for (const r of results.slice(0, 12))
    console.log(`${r.setupName.padEnd(5)} | ${String(r.adxMin).padEnd(3)} | ${String(r.slBuf).padEnd(5)} | ${String(r.tp1R).padEnd(4)} | ${String(r.tp2R).padEnd(4)} | ${String(r.n).padEnd(6)} | ${String(r.wr).padEnd(4)} | ${String(r.pf).padEnd(4)} | ${String(r.pnl).padEnd(8)} | ${r.maxDD}`);

  if (results[0]) {
    console.log('\nBest config setup breakdown:', JSON.stringify(results[0].bySetup));
  }
  const losers = results.filter(r => r.pf < 1).length;
  console.log(`Configs profitable: ${results.length - losers}/${results.length}`);
  return results;
}

module.exports={simulate,fetchYahoo};