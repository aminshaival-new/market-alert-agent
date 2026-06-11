#!/usr/bin/env node
// GOLD 1H strategy lab — walk-forward validation of 3 strategy families:
//   A) Donchian breakout + chandelier trail (classic trend following)
//   B) EMA pullback on 1H with 4H trend filter (killshot logic, higher TF)
//   C) London open range breakout (structural session play)
// Data: PAXGUSDT 1h (gold-backed token = spot gold proxy), ~3 years
// Cost model: 0.03% of price round trip (XAUUSD CFD spread+slippage)
// Usage: node backtest/gold1h.js

const { fetchBinance } = require('./backtest');

// ── Indicators ────────────────────────────────────────────────
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
  return {
    n: trades.length,
    wr: trades.length ? +(100 * wins.length / trades.length).toFixed(1) : 0,
    pf: gl > 0 ? +(gw / gl).toFixed(2) : (gw > 0 ? 99 : 0),
    pnl: +cum.toFixed(1), maxDD: +dd.toFixed(1)
  };
}

// ── Strategy A: Donchian breakout + chandelier trail ──────────
function simDonchian(bars, p) {
  const atr = atrArr(bars, 14), adx = adxArr(bars, 14);
  const trades = []; let pos = null;
  for (let i = p.len + 5; i < bars.length; i++) {
    const b = bars[i];
    if (pos) {
      if (pos.dir === 1) {
        pos.hh = Math.max(pos.hh, b.h);
        const trail = pos.hh - atr[i] * p.trailMult;
        if (b.c < trail || b.l <= pos.sl) {
          const px = b.l <= pos.sl ? pos.sl : b.c;
          trades.push({ pnl: (px - pos.entry) - p.cost }); pos = null;
        }
      } else {
        pos.ll = Math.min(pos.ll, b.l);
        const trail = pos.ll + atr[i] * p.trailMult;
        if (b.c > trail || b.h >= pos.sl) {
          const px = b.h >= pos.sl ? pos.sl : b.c;
          trades.push({ pnl: (pos.entry - px) - p.cost }); pos = null;
        }
      }
      if (pos) continue;
    }
    if (p.adxMin && adx[i] < p.adxMin) continue;
    let hh = -Infinity, ll = Infinity;
    for (let j = i - p.len; j < i; j++) { hh = Math.max(hh, bars[j].h); ll = Math.min(ll, bars[j].l); }
    if (b.c > hh)      pos = { dir: 1,  entry: b.c, sl: b.c - atr[i] * p.slMult, hh: b.h };
    else if (b.c < ll && !p.longOnly) pos = { dir: -1, entry: b.c, sl: b.c + atr[i] * p.slMult, ll: b.l };
  }
  return stats(trades);
}

// ── Strategy B: 1H EMA pullback, 4H trend filter ──────────────
function simPullback1H(bars, p) {
  const closes = bars.map(b => b.c);
  const emaF = ema(closes, 9), emaM = ema(closes, 21), emaS = ema(closes, 50);
  const atr = atrArr(bars, 14), adx = adxArr(bars, 14);
  // 4H ema50 trend (resample by 4 bars)
  const h4c = []; for (let i = 3; i < bars.length; i += 4) h4c.push(bars[i].c);
  const h4e = ema(h4c, 50);
  const trades = []; let pos = null;
  for (let i = 60; i < bars.length; i++) {
    const b = bars[i];
    if (pos) {
      if (pos.dir === 1) {
        if (b.l <= pos.sl) { trades.push({ pnl: (pos.half ? 0.5 * (pos.tp1 - pos.entry) + 0.5 * (pos.sl - pos.entry) : pos.sl - pos.entry) - p.cost }); pos = null; }
        else { if (!pos.half && b.h >= pos.tp1) { pos.half = true; pos.sl = pos.entry; } if (pos && pos.half && b.h >= pos.tp2) { trades.push({ pnl: 0.5 * (pos.tp1 - pos.entry) + 0.5 * (pos.tp2 - pos.entry) - p.cost }); pos = null; } }
      } else {
        if (b.h >= pos.sl) { trades.push({ pnl: (pos.half ? 0.5 * (pos.entry - pos.tp1) + 0.5 * (pos.entry - pos.sl) : pos.entry - pos.sl) - p.cost }); pos = null; }
        else { if (!pos.half && b.l <= pos.tp1) { pos.half = true; pos.sl = pos.entry; } if (pos && pos.half && b.l <= pos.tp2) { trades.push({ pnl: 0.5 * (pos.entry - pos.tp1) + 0.5 * (pos.entry - pos.tp2) - p.cost }); pos = null; } }
      }
      if (pos) continue;
    }
    const h4i = Math.min(Math.floor(i / 4), h4e.length - 1) - 1;
    if (h4i < 1) continue;
    const htfBull = h4c[h4i] > h4e[h4i], htfBear = h4c[h4i] < h4e[h4i];
    const a = atr[i]; if (!a) continue;
    if (adx[i] < p.adxMin) continue;
    const sep = Math.abs(emaM[i] - emaS[i]) >= a * 0.25;
    const bullStack = emaF[i] > emaM[i] && emaM[i] > emaS[i] && b.c > emaS[i] && sep && emaM[i] > emaM[i - 3];
    const bearStack = emaF[i] < emaM[i] && emaM[i] < emaS[i] && b.c < emaS[i] && sep && emaM[i] < emaM[i - 3];
    const pbL = bullStack && htfBull && b.l <= emaM[i] && b.c > emaM[i] && b.c > b.o;
    const pbS = bearStack && htfBear && b.h >= emaM[i] && b.c < emaM[i] && b.c < b.o;
    if (!pbL && !pbS) continue;
    let lo = Infinity, hi = -Infinity;
    for (let j = i - 7; j <= i; j++) { lo = Math.min(lo, bars[j].l); hi = Math.max(hi, bars[j].h); }
    if (pbL) { const sl = lo - a * p.slBuf, r = b.c - sl; if (r > a * 0.3) pos = { dir: 1, entry: b.c, sl, tp1: b.c + r * p.tp1R, tp2: b.c + r * p.tp2R, half: false }; }
    else     { const sl = hi + a * p.slBuf, r = sl - b.c; if (r > a * 0.3) pos = { dir: -1, entry: b.c, sl, tp1: b.c - r * p.tp1R, tp2: b.c - r * p.tp2R, half: false }; }
  }
  return stats(trades);
}

// ── Strategy C: London open range breakout ────────────────────
// Box = 00:00–07:00 UTC range. First break during 07:00–12:00 UTC
// enters; SL = other side of box (capped), TP = boxSize × tpMult;
// force-exit 20:00 UTC.
function simLondon(bars, p) {
  const trades = []; let pos = null;
  let day = '', boxHi = -Infinity, boxLo = Infinity, traded = false;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]; const d = new Date(b.t);
    const dayKey = d.toISOString().slice(0, 10); const hr = d.getUTCHours();
    if (dayKey !== day) { day = dayKey; boxHi = -Infinity; boxLo = Infinity; traded = false; }
    if (pos) {
      const exitNow = hr >= 20;
      if (pos.dir === 1) {
        if (b.l <= pos.sl) { trades.push({ pnl: pos.sl - pos.entry - p.cost }); pos = null; }
        else if (b.h >= pos.tp) { trades.push({ pnl: pos.tp - pos.entry - p.cost }); pos = null; }
        else if (exitNow) { trades.push({ pnl: b.c - pos.entry - p.cost }); pos = null; }
      } else {
        if (b.h >= pos.sl) { trades.push({ pnl: pos.entry - pos.sl - p.cost }); pos = null; }
        else if (b.l <= pos.tp) { trades.push({ pnl: pos.entry - pos.tp - p.cost }); pos = null; }
        else if (exitNow) { trades.push({ pnl: pos.entry - b.c - p.cost }); pos = null; }
      }
      continue;
    }
    if (hr < 7) { boxHi = Math.max(boxHi, b.h); boxLo = Math.min(boxLo, b.l); continue; }
    if (traded || hr >= 12 || boxHi === -Infinity) continue;
    const box = boxHi - boxLo;
    if (box <= 0) continue;
    // box size filter: skip days with abnormally large overnight range
    const pctBox = box / b.c;
    if (pctBox > p.maxBoxPct) continue;
    if (b.c > boxHi) { pos = { dir: 1,  entry: b.c, sl: Math.max(boxLo, b.c - box * p.slCap), tp: b.c + box * p.tpMult }; traded = true; }
    else if (b.c < boxLo) { pos = { dir: -1, entry: b.c, sl: Math.min(boxHi, b.c + box * p.slCap), tp: b.c - box * p.tpMult }; traded = true; }
  }
  return stats(trades);
}

// ── Walk-forward harness ──────────────────────────────────────
function wf(name, bars, grid, simFn, cost) {
  console.log(`\n──── ${name} ────`);
  const foldSize = Math.floor(bars.length / 4);
  const oos = [];
  for (let f = 0; f < 3; f++) {
    const train = bars.slice(f * foldSize, (f + 1) * foldSize + 100);
    const test  = bars.slice((f + 1) * foldSize, (f + 2) * foldSize + 100);
    let best = null;
    for (const g of grid) {
      const r = simFn(train, { ...g, cost });
      if (r.n >= 10 && (!best || r.pf > best.pf)) best = { ...g, ...r };
    }
    if (!best) { console.log(`fold ${f + 1}: insufficient trades`); continue; }
    const o = simFn(test, { ...best, cost });
    oos.push(o.pf);
    const gs = JSON.stringify(Object.fromEntries(Object.entries(best).filter(([k]) => !['n','wr','pf','pnl','maxDD','cost'].includes(k))));
    console.log(`fold ${f + 1}: IS PF=${best.pf} (${best.n}tr) ${gs} → OOS PF=${o.pf} (${o.n}tr, WR ${o.wr}%, pnl ${o.pnl})`);
  }
  const med = oos.sort((a, b) => a - b)[Math.floor(oos.length / 2)] || 0;
  const allPos = oos.length === 3 && oos.every(x => x > 1);
  console.log(`median OOS PF = ${med.toFixed(2)} | all folds profitable: ${allPos ? 'YES ✅' : 'no'}`);
  return { med, allPos };
}

module.exports = { simDonchian, simPullback1H, simLondon, stats };

if (require.main === module) (async () => {
  const bars = await fetchBinance('PAXGUSDT', '1h', 1080);
  console.log(`GOLD 1H (PAXG): ${bars.length} bars  ${new Date(bars[0].t).toISOString().slice(0,10)} → ${new Date(bars[bars.length-1].t).toISOString().slice(0,10)}`);
  const cost = bars[bars.length - 1].c * 0.0003;
  console.log(`cost per round trip: ${cost.toFixed(2)} pts`);

  // A: Donchian
  const gridA = [];
  for (const len of [24, 48, 96]) for (const trailMult of [2, 3, 4]) for (const slMult of [1.5, 2.5]) for (const adxMin of [0, 20])
    gridA.push({ len, trailMult, slMult, adxMin });
  const a = wf('A) Donchian breakout + chandelier trail', bars, gridA, simDonchian, cost);

  // B: EMA pullback 1H
  const gridB = [];
  for (const adxMin of [18, 22, 26]) for (const slBuf of [0.6, 1.0]) for (const tp1R of [1.0, 1.5]) for (const tp2R of [2.0, 3.0])
    gridB.push({ adxMin, slBuf, tp1R, tp2R });
  const b = wf('B) 1H EMA pullback + 4H trend filter', bars, gridB, simPullback1H, cost);

  // C: London breakout
  const gridC = [];
  for (const tpMult of [1.0, 1.5, 2.0]) for (const slCap of [0.5, 1.0]) for (const maxBoxPct of [0.006, 0.01, 99])
    gridC.push({ tpMult, slCap, maxBoxPct });
  const c = wf('C) London open range breakout', bars, gridC, simLondon, cost);

  console.log('\n════ GOLD 1H SUMMARY ════');
  console.log(`A Donchian:        median OOS PF ${a.med.toFixed(2)} ${a.med >= 1.15 ? '✅' : '❌'}`);
  console.log(`B EMA pullback 1H: median OOS PF ${b.med.toFixed(2)} ${b.med >= 1.15 ? '✅' : '❌'}`);
  console.log(`C London breakout: median OOS PF ${c.med.toFixed(2)} ${c.med >= 1.15 ? '✅' : '❌'}`);
})();
