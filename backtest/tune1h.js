#!/usr/bin/env node
// Tune the validated GOLD 1H Donchian system — feature search with
// fold-robustness criterion (must work in most regimes, not just one).
// Features tested: breakout buffer, partial profit + BE, daily trend
// filter, long-only, trail/len variations. Also: does the same system
// work on 15m/5m? (spoiler check with real costs)
// Usage: node backtest/tune1h.js

const { fetchBinance } = require('./backtest');

function ema(src, len) {
  const out = new Array(src.length); const k = 2 / (len + 1);
  let prev = src[0]; out[0] = prev;
  for (let i = 1; i < src.length; i++) { prev = src[i] * k + prev * (1 - k); out[i] = prev; }
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
function stats(trades) {
  const wins = trades.filter(t => t.pnl > 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0);
  const gl = Math.abs(trades.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
  let cum = 0, peak = 0, dd = 0;
  for (const t of trades) { cum += t.pnl; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); }
  return { n: trades.length, wr: trades.length ? +(100 * wins.length / trades.length).toFixed(1) : 0,
    pf: gl > 0 ? +(gw / gl).toFixed(2) : (gw > 0 ? 99 : 0), pnl: +cum.toFixed(1), maxDD: +dd.toFixed(1) };
}

// Enhanced Donchian sim with optional features
function sim(bars, p) {
  const atr = atrArr(bars, 14), adx = adxArr(bars, 14);
  const closes = bars.map(b => b.c);
  const trendEma = p.trendLen ? ema(closes, p.trendLen) : null;
  const trades = []; let pos = null;
  for (let i = Math.max(p.len, p.trendLen || 0) + 5; i < bars.length; i++) {
    const b = bars[i];
    if (pos) {
      const closeTrade = (px) => {
        const dirPnl = pos.dir * (px - pos.entry);
        const banked = pos.banked || 0;
        trades.push({ pnl: (pos.half ? 0.5 * dirPnl : dirPnl) + banked - p.cost });
        pos = null;
      };
      if (pos.dir === 1) {
        pos.hh = Math.max(pos.hh, b.h);
        // partial profit
        if (p.partialR > 0 && !pos.half && b.h >= pos.entry + pos.risk * p.partialR) {
          pos.half = true; pos.banked = 0.5 * pos.risk * p.partialR; pos.sl = pos.entry;
        }
        const trail = pos.hh - atr[i] * p.trailMult;
        if (b.l <= pos.sl) closeTrade(pos.sl);
        else if (b.c < trail) closeTrade(b.c);
      } else {
        pos.ll = Math.min(pos.ll, b.l);
        if (p.partialR > 0 && !pos.half && b.l <= pos.entry - pos.risk * p.partialR) {
          pos.half = true; pos.banked = 0.5 * pos.risk * p.partialR; pos.sl = pos.entry;
        }
        const trail = pos.ll + atr[i] * p.trailMult;
        if (b.h >= pos.sl) closeTrade(pos.sl);
        else if (b.c > trail) closeTrade(b.c);
      }
      if (pos) continue;
    }
    if (adx[i] < p.adxMin) continue;
    let hh = -Infinity, ll = Infinity;
    for (let j = i - p.len; j < i; j++) { hh = Math.max(hh, bars[j].h); ll = Math.min(ll, bars[j].l); }
    const buf = atr[i] * (p.breakBuf || 0);
    const trendUp = !trendEma || b.c > trendEma[i];
    const trendDn = !trendEma || b.c < trendEma[i];
    if (b.c > hh + buf && trendUp)
      pos = { dir: 1, entry: b.c, sl: b.c - atr[i] * p.slMult, risk: atr[i] * p.slMult, hh: b.h, half: false, banked: 0 };
    else if (b.c < ll - buf && trendDn && !p.longOnly)
      pos = { dir: -1, entry: b.c, sl: b.c + atr[i] * p.slMult, risk: atr[i] * p.slMult, ll: b.l, half: false, banked: 0 };
  }
  return stats(trades);
}

function foldEval(bars, p, cost) {
  const foldSize = Math.floor(bars.length / 4);
  const folds = [0, 1, 2, 3].map(f => bars.slice(f * foldSize, (f + 1) * foldSize + 100));
  const rs = folds.map(f => sim(f, { ...p, cost }));
  return {
    profitable: rs.filter(r => r.pf > 1).length,
    minPF: Math.min(...rs.map(r => r.pf)),
    totPnl: +rs.reduce((s, r) => s + r.pnl, 0).toFixed(0),
    totN: rs.reduce((s, r) => s + r.n, 0),
    avgWR: +(rs.reduce((s, r) => s + r.wr, 0) / 4).toFixed(0),
    perFold: rs.map(r => `${r.pf}(${r.n})`).join(' ')
  };
}

(async () => {
  const bars = await fetchBinance('PAXGUSDT', '1h', 1080);
  const cost = bars[bars.length - 1].c * 0.0003;
  console.log(`GOLD 1H tune — ${bars.length} bars, cost ${cost.toFixed(2)} pts/round-trip\n`);

  // baseline
  const base = { len: 48, trailMult: 4, slMult: 2.5, adxMin: 15, breakBuf: 0, partialR: 0, trendLen: 0, longOnly: false };
  console.log('BASELINE (current Pine defaults):', JSON.stringify(foldEval(bars, base, cost)));

  const rows = [];
  for (const len of [48, 72])
    for (const trailMult of [3, 4, 5])
      for (const breakBuf of [0, 0.25])
        for (const partialR of [0, 1.5, 2.5])
          for (const trendLen of [0, 200, 480])
            for (const longOnly of [false, true]) {
              const p = { len, trailMult, slMult: 2.5, adxMin: 15, breakBuf, partialR, trendLen, longOnly };
              const r = foldEval(bars, p, cost);
              if (r.totN >= 60) rows.push({ ...p, ...r });
            }
  rows.sort((a, b) => b.profitable - a.profitable || b.minPF - a.minPF || b.totPnl - a.totPnl);
  console.log('\nTOP 15 by fold-robustness (folds>1 desc, worst-fold PF desc):');
  console.log('len trail buf partR trend LO | folds | minPF | totPnL | n | WR | per-fold');
  for (const r of rows.slice(0, 15))
    console.log(`${r.len} ${r.trailMult} ${r.breakBuf} ${String(r.partialR).padEnd(3)} ${String(r.trendLen).padEnd(3)} ${r.longOnly ? 'Y' : 'N'} | ${r.profitable}/4 | ${String(r.minPF).padEnd(5)} | ${String(r.totPnl).padStart(6)} | ${r.totN} | ${r.avgWR}% | ${r.perFold}`);

  // ── Lower timeframes: same system, real costs ───────────────
  console.log('\n──── SAME SYSTEM ON LOWER TIMEFRAMES (best 1H config, scaled) ────');
  const best = rows[0] || base;
  for (const [tf, days, costMult] of [['15m', 360, 0.0003], ['5m', 120, 0.0003]]) {
    const lowBars = await fetchBinance('PAXGUSDT', tf, days);
    const lowCost = lowBars[lowBars.length - 1].c * costMult;
    const r = foldEval(lowBars, best, lowCost);
    console.log(`${tf}: ${JSON.stringify(r)}`);
  }
})();
