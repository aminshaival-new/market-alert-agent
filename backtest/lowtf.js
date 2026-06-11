#!/usr/bin/env node
// LOW TIMEFRAME LAB — gold 15m & 5m, mean-reversion families
// (trend systems are proven dead on low TF; reversion is the
//  only family with a documented intraday edge)
//   A) RSI-2 dip buy with trend filter (Connors-style)
//   B) Bollinger band fade in low-ADX regime
//   C) VWAP deviation reversion (daily anchored)
// 4-fold fixed-config robustness, two cost scenarios.
// Usage: node backtest/lowtf.js

const { fetchBinance } = require('./backtest');

function sma(src, len) {
  const out = new Array(src.length).fill(NaN); let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i]; if (i >= len) sum -= src[i - len];
    if (i >= len - 1) out[i] = sum / len;
  }
  return out;
}
function rma(src, len) {
  const out = new Array(src.length); let sum = 0;
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
  const pDM = [0], mDM = [0];
  for (let i = 1; i < bars.length; i++) {
    const up = bars[i].h - bars[i - 1].h, dn = bars[i - 1].l - bars[i].l;
    pDM.push(up > dn && up > 0 ? up : 0); mDM.push(dn > up && dn > 0 ? dn : 0);
  }
  const atr = atrArr(bars, len);
  const pdi = rma(pDM, len).map((v, i) => 100 * v / (atr[i] || 1));
  const mdi = rma(mDM, len).map((v, i) => 100 * v / (atr[i] || 1));
  const dx = pdi.map((p, i) => { const s = p + mdi[i]; return s === 0 ? 0 : 100 * Math.abs(p - mdi[i]) / s; });
  return rma(dx, len);
}
function stdev(src, len) {
  const m = sma(src, len);
  const out = new Array(src.length).fill(NaN);
  for (let i = len - 1; i < src.length; i++) {
    let s = 0;
    for (let j = i - len + 1; j <= i; j++) s += (src[j] - m[i]) ** 2;
    out[i] = Math.sqrt(s / len);
  }
  return out;
}
function stats(trades) {
  const wins = trades.filter(t => t.pnl > 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0);
  const gl = Math.abs(trades.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
  let cum = 0, peak = 0, dd = 0;
  for (const t of trades) { cum += t.pnl; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); }
  return { n: trades.length, wr: trades.length ? +(100 * wins.length / trades.length).toFixed(1) : 0,
    pf: gl > 0 ? +(gw / gl).toFixed(2) : (gw > 0 ? 99 : 0), pnl: +cum.toFixed(1), maxDD: +dd.toFixed(1) };
}

// ── A) RSI-2 dip buy (Connors) ───────────────────────────────
function simRSI2(bars, p) {
  const closes = bars.map(b => b.c);
  const rsi2 = rsiArr(closes, 2), trendMA = sma(closes, p.trendLen), atr = atrArr(bars, 14);
  const trades = []; let pos = null;
  for (let i = p.trendLen + 2; i < bars.length; i++) {
    const b = bars[i];
    if (pos) {
      pos.bars++;
      if (pos.dir === 1) {
        if (b.l <= pos.sl) { trades.push({ pnl: pos.sl - pos.entry - p.cost }); pos = null; }
        else if (rsi2[i] > p.exitLvl || pos.bars >= p.maxBars) { trades.push({ pnl: b.c - pos.entry - p.cost }); pos = null; }
      } else {
        if (b.h >= pos.sl) { trades.push({ pnl: pos.entry - pos.sl - p.cost }); pos = null; }
        else if (rsi2[i] < 100 - p.exitLvl || pos.bars >= p.maxBars) { trades.push({ pnl: pos.entry - b.c - p.cost }); pos = null; }
      }
      continue;
    }
    if (rsi2[i] < p.entryLvl && b.c > trendMA[i])
      pos = { dir: 1, entry: b.c, sl: b.c - atr[i] * p.slMult, bars: 0 };
    else if (!p.longOnly && rsi2[i] > 100 - p.entryLvl && b.c < trendMA[i])
      pos = { dir: -1, entry: b.c, sl: b.c + atr[i] * p.slMult, bars: 0 };
  }
  return stats(trades);
}

// ── B) Bollinger fade in low-ADX ─────────────────────────────
function simBBFade(bars, p) {
  const closes = bars.map(b => b.c);
  const mid = sma(closes, 20), sd = stdev(closes, 20), adx = adxArr(bars, 14), atr = atrArr(bars, 14);
  const trades = []; let pos = null;
  for (let i = 30; i < bars.length; i++) {
    const b = bars[i];
    if (pos) {
      pos.bars++;
      if (pos.dir === 1) {
        if (b.l <= pos.sl) { trades.push({ pnl: pos.sl - pos.entry - p.cost }); pos = null; }
        else if (b.c >= mid[i] || pos.bars >= p.maxBars) { trades.push({ pnl: b.c - pos.entry - p.cost }); pos = null; }
      } else {
        if (b.h >= pos.sl) { trades.push({ pnl: pos.entry - pos.sl - p.cost }); pos = null; }
        else if (b.c <= mid[i] || pos.bars >= p.maxBars) { trades.push({ pnl: pos.entry - b.c - p.cost }); pos = null; }
      }
      continue;
    }
    if (adx[i] >= p.adxMax) continue;
    const lower = mid[i] - sd[i] * p.bbMult, upper = mid[i] + sd[i] * p.bbMult;
    if (b.c < lower && b.c > b.o) pos = { dir: 1, entry: b.c, sl: b.c - atr[i] * p.slMult, bars: 0 };
    else if (b.c > upper && b.c < b.o && !p.longOnly) pos = { dir: -1, entry: b.c, sl: b.c + atr[i] * p.slMult, bars: 0 };
  }
  return stats(trades);
}

// ── C) VWAP deviation reversion ──────────────────────────────
function simVWAP(bars, p) {
  const atr = atrArr(bars, 14);
  const trades = []; let pos = null;
  let day = '', cumPV = 0, cumV = 0;
  const vwapArr = new Array(bars.length).fill(NaN);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const dk = new Date(b.t).toISOString().slice(0, 10);
    if (dk !== day) { day = dk; cumPV = 0; cumV = 0; }
    const tp = (b.h + b.l + b.c) / 3;
    cumPV += tp * (b.v || 1); cumV += (b.v || 1);
    vwapArr[i] = cumPV / cumV;
  }
  for (let i = 30; i < bars.length; i++) {
    const b = bars[i]; const vw = vwapArr[i];
    if (pos) {
      pos.bars++;
      if (pos.dir === 1) {
        if (b.l <= pos.sl) { trades.push({ pnl: pos.sl - pos.entry - p.cost }); pos = null; }
        else if (b.h >= pos.tp || pos.bars >= p.maxBars) { trades.push({ pnl: (b.h >= pos.tp ? pos.tp : b.c) - pos.entry - p.cost }); pos = null; }
      } else {
        if (b.h >= pos.sl) { trades.push({ pnl: pos.entry - pos.sl - p.cost }); pos = null; }
        else if (b.l <= pos.tp || pos.bars >= p.maxBars) { trades.push({ pnl: pos.entry - (b.l <= pos.tp ? pos.tp : b.c) - p.cost }); pos = null; }
      }
      continue;
    }
    const dev = b.c - vw; const a = atr[i];
    if (dev < -a * p.devMult && b.c > b.o)
      pos = { dir: 1, entry: b.c, sl: b.c - a * p.slMult, tp: vw, bars: 0 };
    else if (dev > a * p.devMult && b.c < b.o && !p.longOnly)
      pos = { dir: -1, entry: b.c, sl: b.c + a * p.slMult, tp: vw, bars: 0 };
  }
  return stats(trades);
}

function foldEval(bars, simFn, p, cost) {
  const foldSize = Math.floor(bars.length / 4);
  const folds = [0, 1, 2, 3].map(f => bars.slice(f * foldSize, (f + 1) * foldSize + 300));
  const rs = folds.map(f => simFn(f, { ...p, cost }));
  return { profitable: rs.filter(r => r.pf > 1).length, minPF: Math.min(...rs.map(r => r.pf)),
    totPnl: +rs.reduce((s, r) => s + r.pnl, 0).toFixed(0), totN: rs.reduce((s, r) => s + r.n, 0),
    avgWR: +(rs.reduce((s, r) => s + r.wr, 0) / 4).toFixed(0), perFold: rs.map(r => `${r.pf}(${r.n})`).join(' ') };
}

(async () => {
  for (const [tf, days] of [['15m', 360], ['5m', 120]]) {
    const bars = await fetchBinance('PAXGUSDT', tf, days);
    const px = bars[bars.length - 1].c;
    console.log(`\n════════ GOLD ${tf} — ${bars.length} bars, ${days}d ════════`);
    for (const [costName, cost] of [['realistic 0.03%', px * 0.0003], ['tight 0.015%', px * 0.00015]]) {
      console.log(`\n-- cost: ${costName} (${cost.toFixed(2)} pts) --`);
      const rows = [];
      // A grids
      for (const entryLvl of [5, 10]) for (const exitLvl of [60, 70]) for (const trendLen of [100, 200]) for (const slMult of [1.5, 2.5]) for (const longOnly of [true, false])
        rows.push({ fam: 'RSI2', cfg: `e${entryLvl}/x${exitLvl}/t${trendLen}/sl${slMult}${longOnly?'/LO':''}`, ...foldEval(bars, simRSI2, { entryLvl, exitLvl, trendLen, slMult, maxBars: 30, longOnly }, cost) });
      // B grids
      for (const bbMult of [2.0, 2.5]) for (const adxMax of [20, 25]) for (const slMult of [1.5, 2.5]) for (const longOnly of [true, false])
        rows.push({ fam: 'BBfade', cfg: `bb${bbMult}/adx<${adxMax}/sl${slMult}${longOnly?'/LO':''}`, ...foldEval(bars, simBBFade, { bbMult, adxMax, slMult, maxBars: 40, longOnly }, cost) });
      // C grids
      for (const devMult of [2.0, 3.0]) for (const slMult of [1.5, 2.5]) for (const longOnly of [true, false])
        rows.push({ fam: 'VWAP', cfg: `dev${devMult}/sl${slMult}${longOnly?'/LO':''}`, ...foldEval(bars, simVWAP, { devMult, slMult, maxBars: 40, longOnly }, cost) });

      rows.sort((a, b) => b.profitable - a.profitable || b.minPF - a.minPF);
      const top = rows.filter(r => r.totN >= 40).slice(0, 8);
      console.log('family | config | folds>1 | minPF | totPnL | n | WR | per-fold');
      for (const r of top)
        console.log(`${r.fam.padEnd(6)} | ${r.cfg.padEnd(24)} | ${r.profitable}/4 | ${String(r.minPF).padEnd(5)} | ${String(r.totPnl).padStart(6)} | ${r.totN} | ${r.avgWR}% | ${r.perFold}`);
    }
  }
})();
