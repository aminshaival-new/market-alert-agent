#!/usr/bin/env node
// ORDERFLOW + VOLUME PROFILE LAB — gold 15m
//   A1) Delta-confirmed breakout: range break + aggressive taker
//       delta z-score confirmation (+ kill zone)
//   A2) CVD divergence reversal: price lower-low while cumulative
//       volume delta makes higher-low → absorption → reversal
//   B1) Volume profile reversion: fixed-range profile (96 bars),
//       entry at value-area edge, target POC, low-ADX regime
// Data: Binance klines with taker-buy volume (true orderflow per bar)
// Usage: node backtest/orderflow.js

const fs = require('fs');
const path = require('path');
const CACHE = path.join(__dirname, 'cache');

async function fetchFlow(symbol, interval, days) {
  const file = path.join(CACHE, `${symbol}-${interval}-${days}d-flow.json`);
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
    for (const k of data) bars.push({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], tb: +k[9] });
    endTime = data[0][0] - 1;
    await new Promise(r => setTimeout(r, 250));
  }
  bars.sort((a, b) => a.t - b.t);
  const uniq = bars.filter((b, i) => i === 0 || b.t !== bars[i - 1].t);
  fs.writeFileSync(file, JSON.stringify(uniq));
  return uniq;
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
  return { n: trades.length, wr: trades.length ? +(100 * wins.length / trades.length).toFixed(1) : 0,
    pf: gl > 0 ? +(gw / gl).toFixed(2) : (gw > 0 ? 99 : 0), pnl: +trades.reduce((s, t) => s + t.pnl, 0).toFixed(1) };
}
function inKZ(t) { const h = new Date(t).getUTCHours(); return (h >= 7 && h < 10) || (h >= 12 && h < 15); }
function manage(pos, b, trades, cost) {
  if (pos.dir === 1) {
    if (b.l <= pos.sl) { trades.push({ pnl: pos.sl - pos.entry - cost }); return null; }
    if (b.h >= pos.tp) { trades.push({ pnl: pos.tp - pos.entry - cost }); return null; }
  } else {
    if (b.h >= pos.sl) { trades.push({ pnl: pos.entry - pos.sl - cost }); return null; }
    if (b.l <= pos.tp) { trades.push({ pnl: pos.entry - pos.tp - cost }); return null; }
  }
  if (++pos.bars >= pos.maxBars) { trades.push({ pnl: pos.dir * (b.c - pos.entry) - cost }); return null; }
  return pos;
}

// delta arrays: delta = taker buy - taker sell; z-score over 50 bars
function deltaArrays(bars) {
  const delta = bars.map(b => b.tb - (b.v - b.tb));
  const cvd = []; let c = 0;
  for (const d of delta) { c += d; cvd.push(c); }
  const z = new Array(bars.length).fill(0);
  for (let i = 50; i < bars.length; i++) {
    let m = 0; for (let j = i - 50; j < i; j++) m += delta[j]; m /= 50;
    let sd = 0; for (let j = i - 50; j < i; j++) sd += (delta[j] - m) ** 2; sd = Math.sqrt(sd / 50) || 1;
    z[i] = (delta[i] - m) / sd;
  }
  return { delta, cvd, z };
}

// A1: delta-confirmed breakout
function simDeltaBreak(bars, p) {
  const atr = atrArr(bars, 14);
  const { z } = deltaArrays(bars);
  const trades = []; let pos = null;
  for (let i = 100; i < bars.length; i++) {
    const b = bars[i];
    if (pos) { pos = manage(pos, b, trades, p.cost); continue; }
    if (p.killZone && !inKZ(b.t)) continue;
    let hh = -Infinity, ll = Infinity;
    for (let j = i - p.rangeLen; j < i; j++) { hh = Math.max(hh, bars[j].h); ll = Math.min(ll, bars[j].l); }
    if (b.c > hh && z[i] >= p.zMin)
      pos = { dir: 1, entry: b.c, sl: b.c - atr[i] * p.slMult, tp: b.c + atr[i] * p.slMult * p.rr, bars: 0, maxBars: 60 };
    else if (b.c < ll && z[i] <= -p.zMin && !p.longOnly)
      pos = { dir: -1, entry: b.c, sl: b.c + atr[i] * p.slMult, tp: b.c - atr[i] * p.slMult * p.rr, bars: 0, maxBars: 60 };
  }
  return stats(trades);
}

// A2: CVD divergence reversal at swing extremes
function simCVDDiv(bars, p) {
  const atr = atrArr(bars, 14);
  const { cvd } = deltaArrays(bars);
  const trades = []; let pos = null;
  for (let i = 60; i < bars.length; i++) {
    const b = bars[i];
    if (pos) { pos = manage(pos, b, trades, p.cost); continue; }
    if (p.killZone && !inKZ(b.t)) continue;
    // swing low p.look bars ago vs now: price LL, cvd HL, bullish close
    let priceMinIdx = i - 1, cvdAtMin = 0;
    let lo = Infinity;
    for (let j = i - p.look; j < i - 3; j++) if (bars[j].l < lo) { lo = bars[j].l; priceMinIdx = j; }
    const priceLL = b.l < lo;
    const cvdHL = cvd[i] > cvd[priceMinIdx];
    if (priceLL && cvdHL && b.c > b.o) {
      pos = { dir: 1, entry: b.c, sl: b.l - atr[i] * 0.3, tp: b.c + (b.c - (b.l - atr[i] * 0.3)) * p.rr, bars: 0, maxBars: 40 };
      continue;
    }
    let hi = -Infinity, priceMaxIdx = i - 1;
    for (let j = i - p.look; j < i - 3; j++) if (bars[j].h > hi) { hi = bars[j].h; priceMaxIdx = j; }
    const priceHH = b.h > hi;
    const cvdLH = cvd[i] < cvd[priceMaxIdx];
    if (priceHH && cvdLH && b.c < b.o && !p.longOnly)
      pos = { dir: -1, entry: b.c, sl: b.h + atr[i] * 0.3, tp: b.c - ((b.h + atr[i] * 0.3) - b.c) * p.rr, bars: 0, maxBars: 40 };
  }
  return stats(trades);
}

// B1: fixed-range volume profile reversion (value edge → POC)
function simVP(bars, p) {
  const atr = atrArr(bars, 14), adx = adxArr(bars, 14);
  const trades = []; let pos = null;
  for (let i = p.rangeLen + 10; i < bars.length; i++) {
    const b = bars[i];
    if (pos) { pos = manage(pos, b, trades, p.cost); continue; }
    if (p.killZone && !inKZ(b.t)) continue;
    if (adx[i] > p.adxMax) continue;
    // build profile over last rangeLen bars
    let lo = Infinity, hi = -Infinity;
    for (let j = i - p.rangeLen; j < i; j++) { lo = Math.min(lo, bars[j].l); hi = Math.max(hi, bars[j].h); }
    const bins = 24, binSize = (hi - lo) / bins || 1e-9;
    const volAt = new Array(bins).fill(0);
    for (let j = i - p.rangeLen; j < i; j++) {
      const bb = bars[j];
      const b0 = Math.max(0, Math.min(bins - 1, Math.floor((bb.l - lo) / binSize)));
      const b1 = Math.max(0, Math.min(bins - 1, Math.floor((bb.h - lo) / binSize)));
      const per = bb.v / (b1 - b0 + 1);
      for (let k = b0; k <= b1; k++) volAt[k] += per;
    }
    let pocBin = 0; for (let k = 1; k < bins; k++) if (volAt[k] > volAt[pocBin]) pocBin = k;
    const poc = lo + (pocBin + 0.5) * binSize;
    // value area ~70%
    const totV = volAt.reduce((s, v) => s + v, 0);
    let vaV = volAt[pocBin], lo_ = pocBin, hi_ = pocBin;
    while (vaV < totV * 0.7 && (lo_ > 0 || hi_ < bins - 1)) {
      const dn = lo_ > 0 ? volAt[lo_ - 1] : -1, up = hi_ < bins - 1 ? volAt[hi_ + 1] : -1;
      if (up >= dn) { hi_++; vaV += volAt[hi_]; } else { lo_--; vaV += volAt[lo_]; }
    }
    const val = lo + lo_ * binSize, vah = lo + (hi_ + 1) * binSize;
    // entries: at/below VAL with bullish close → target POC; mirror short
    if (b.c <= val && b.c > b.o && poc - b.c > atr[i] * 0.8)
      pos = { dir: 1, entry: b.c, sl: b.c - atr[i] * p.slMult, tp: poc, bars: 0, maxBars: 50 };
    else if (b.c >= vah && b.c < b.o && b.c - poc > atr[i] * 0.8 && !p.longOnly)
      pos = { dir: -1, entry: b.c, sl: b.c + atr[i] * p.slMult, tp: poc, bars: 0, maxBars: 50 };
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
  const bars = await fetchFlow('PAXGUSDT', '15m', 360);
  const px = bars[bars.length - 1].c;
  console.log(`ORDERFLOW LAB — GOLD 15m, ${bars.length} bars, taker-buy delta available\n`);
  for (const [costName, cost] of [['realistic 0.03%', px * 0.0003], ['tight 0.015%', px * 0.00015]]) {
    console.log(`\n-- cost: ${costName} --`);
    const rows = [];
    for (const zMin of [1.0, 1.5]) for (const rangeLen of [48, 96]) for (const rr of [2, 3]) for (const killZone of [true, false]) for (const longOnly of [true, false])
      rows.push({ fam: 'DeltaBrk', cfg: `z${zMin}/r${rangeLen}/rr${rr}${killZone?'/KZ':''}${longOnly?'/LO':''}`, ...foldEval(bars, simDeltaBreak, { zMin, rangeLen, rr, slMult: 1.5, killZone, longOnly }, cost) });
    for (const look of [30, 60]) for (const rr of [2, 3]) for (const killZone of [true, false]) for (const longOnly of [true, false])
      rows.push({ fam: 'CVDdiv', cfg: `look${look}/rr${rr}${killZone?'/KZ':''}${longOnly?'/LO':''}`, ...foldEval(bars, simCVDDiv, { look, rr, killZone, longOnly }, cost) });
    for (const rangeLen of [96, 192]) for (const adxMax of [20, 25]) for (const killZone of [true, false]) for (const longOnly of [true, false])
      rows.push({ fam: 'VolProf', cfg: `r${rangeLen}/adx<${adxMax}${killZone?'/KZ':''}${longOnly?'/LO':''}`, ...foldEval(bars, simVP, { rangeLen, adxMax, slMult: 1.5, killZone, longOnly }, cost) });
    rows.sort((a, b) => b.profitable - a.profitable || b.minPF - a.minPF);
    console.log('family   | config | folds>1 | minPF | totPnL | n | WR | per-fold');
    for (const r of rows.filter(r => r.totN >= 30).slice(0, 10))
      console.log(`${r.fam.padEnd(8)} | ${r.cfg.padEnd(22)} | ${r.profitable}/4 | ${String(r.minPF).padEnd(5)} | ${String(r.totPnl).padStart(6)} | ${r.totN} | ${r.avgWR}% | ${r.perFold}`);
  }
})();
