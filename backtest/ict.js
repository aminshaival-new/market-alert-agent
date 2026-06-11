#!/usr/bin/env node
// ICT / SMC concepts on GOLD lower timeframes — mechanical test
//   Model A: "ICT 2022" — liquidity sweep of prev-day high/low →
//            displacement candle creating FVG → limit entry at FVG
//            50% retrace, SL beyond sweep wick, TP at R multiple.
//            Optional kill-zone filter (London 07-10, NY 12-15 UTC).
//   Model B: FVG retrace with EMA200 trend alignment (simpler SMC)
// 4-fold robustness, realistic + tight costs. 15m and 5m.
// Usage: node backtest/ict.js

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
function stats(trades) {
  const wins = trades.filter(t => t.pnl > 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0);
  const gl = Math.abs(trades.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
  let cum = 0, peak = 0, dd = 0;
  for (const t of trades) { cum += t.pnl; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); }
  return { n: trades.length, wr: trades.length ? +(100 * wins.length / trades.length).toFixed(1) : 0,
    pf: gl > 0 ? +(gw / gl).toFixed(2) : (gw > 0 ? 99 : 0), pnl: +cum.toFixed(1) };
}
function inKillZone(t) {
  const h = new Date(t).getUTCHours();
  return (h >= 7 && h < 10) || (h >= 12 && h < 15);   // London open + NY open
}

// prev-day high/low per bar
function prevDayLevels(bars) {
  const pdh = new Array(bars.length).fill(NaN), pdl = new Array(bars.length).fill(NaN);
  let day = '', curHi = -Infinity, curLo = Infinity, prevHi = NaN, prevLo = NaN;
  for (let i = 0; i < bars.length; i++) {
    const dk = new Date(bars[i].t).toISOString().slice(0, 10);
    if (dk !== day) { prevHi = curHi === -Infinity ? NaN : curHi; prevLo = curLo === Infinity ? NaN : curLo; curHi = -Infinity; curLo = Infinity; day = dk; }
    pdh[i] = prevHi; pdl[i] = prevLo;
    curHi = Math.max(curHi, bars[i].h); curLo = Math.min(curLo, bars[i].l);
  }
  return { pdh, pdl };
}

// ── Model A: ICT 2022 (sweep → displacement+FVG → retrace entry) ──
function simICT2022(bars, p) {
  const atr = atrArr(bars, 14);
  const { pdh, pdl } = prevDayLevels(bars);
  const trades = []; let pos = null;
  let setup = null;   // {dir, fvgMid, sl, expires}
  for (let i = 30; i < bars.length; i++) {
    const b = bars[i]; const a = atr[i];
    // manage position
    if (pos) {
      if (pos.dir === 1) {
        if (b.l <= pos.sl) { trades.push({ pnl: pos.sl - pos.entry - p.cost }); pos = null; }
        else if (b.h >= pos.tp) { trades.push({ pnl: pos.tp - pos.entry - p.cost }); pos = null; }
      } else {
        if (b.h >= pos.sl) { trades.push({ pnl: pos.entry - pos.sl - p.cost }); pos = null; }
        else if (b.l <= pos.tp) { trades.push({ pnl: pos.entry - pos.tp - p.cost }); pos = null; }
      }
      continue;
    }
    // pending setup: fill at FVG mid?
    if (setup) {
      if (i > setup.expires) setup = null;
      else if (setup.dir === 1 && b.l <= setup.fvgMid) {
        const risk = setup.fvgMid - setup.sl;
        if (risk > 0) pos = { dir: 1, entry: setup.fvgMid, sl: setup.sl, tp: setup.fvgMid + risk * p.rr };
        setup = null; continue;
      } else if (setup.dir === -1 && b.h >= setup.fvgMid) {
        const risk = setup.sl - setup.fvgMid;
        if (risk > 0) pos = { dir: -1, entry: setup.fvgMid, sl: setup.sl, tp: setup.fvgMid - risk * p.rr };
        setup = null; continue;
      }
      if (setup) continue;
    }
    if (p.killZone && !inKillZone(b.t)) continue;
    if (isNaN(pdl[i]) || isNaN(pdh[i])) continue;

    // bullish: recent sweep of prev-day low within last 8 bars, then THIS bar
    // is a displacement up candle creating a bullish FVG (low > high[i-2])
    let sweptLowIdx = -1, sweptHighIdx = -1;
    for (let j = i - 8; j < i; j++) {
      if (bars[j].l < pdl[j] && bars[j].c > pdl[j]) sweptLowIdx = j;
      if (bars[j].h > pdh[j] && bars[j].c < pdh[j]) sweptHighIdx = j;
    }
    const body = Math.abs(b.c - b.o), range = b.h - b.l;
    const displaceUp = b.c > b.o && range > a * p.dispMult && body / Math.max(range, 1e-9) > 0.6 && b.l > bars[i - 2].h;
    const displaceDn = b.c < b.o && range > a * p.dispMult && body / Math.max(range, 1e-9) > 0.6 && b.h < bars[i - 2].l;

    if (sweptLowIdx >= 0 && displaceUp) {
      const fvgMid = (b.l + bars[i - 2].h) / 2;
      let wickLo = Infinity; for (let j = sweptLowIdx; j <= i; j++) wickLo = Math.min(wickLo, bars[j].l);
      setup = { dir: 1, fvgMid, sl: wickLo - a * 0.1, expires: i + p.validBars };
    } else if (sweptHighIdx >= 0 && displaceDn && !p.longOnly) {
      const fvgMid = (b.h + bars[i - 2].l) / 2;
      let wickHi = -Infinity; for (let j = sweptHighIdx; j <= i; j++) wickHi = Math.max(wickHi, bars[j].h);
      setup = { dir: -1, fvgMid, sl: wickHi + a * 0.1, expires: i + p.validBars };
    }
  }
  return stats(trades);
}

// ── Model B: FVG retrace + EMA200 trend ──────────────────────
function simFVG(bars, p) {
  const atr = atrArr(bars, 14);
  const trend = ema(bars.map(b => b.c), 200);
  const trades = []; let pos = null; let setup = null;
  for (let i = 210; i < bars.length; i++) {
    const b = bars[i]; const a = atr[i];
    if (pos) {
      if (pos.dir === 1) {
        if (b.l <= pos.sl) { trades.push({ pnl: pos.sl - pos.entry - p.cost }); pos = null; }
        else if (b.h >= pos.tp) { trades.push({ pnl: pos.tp - pos.entry - p.cost }); pos = null; }
      } else {
        if (b.h >= pos.sl) { trades.push({ pnl: pos.entry - pos.sl - p.cost }); pos = null; }
        else if (b.l <= pos.tp) { trades.push({ pnl: pos.entry - pos.tp - p.cost }); pos = null; }
      }
      continue;
    }
    if (setup) {
      if (i > setup.expires) setup = null;
      else if (setup.dir === 1 && b.l <= setup.mid) {
        const risk = setup.mid - setup.sl;
        if (risk > 0) pos = { dir: 1, entry: setup.mid, sl: setup.sl, tp: setup.mid + risk * p.rr };
        setup = null; continue;
      } else if (setup.dir === -1 && b.h >= setup.mid) {
        const risk = setup.sl - setup.mid;
        if (risk > 0) pos = { dir: -1, entry: setup.mid, sl: setup.sl, tp: setup.mid - risk * p.rr };
        setup = null; continue;
      }
      if (setup) continue;
    }
    if (p.killZone && !inKillZone(b.t)) continue;
    const gapUp = b.l > bars[i - 2].h && (b.l - bars[i - 2].h) > a * p.minGap;
    const gapDn = b.h < bars[i - 2].l && (bars[i - 2].l - b.h) > a * p.minGap;
    if (gapUp && b.c > trend[i]) setup = { dir: 1, mid: (b.l + bars[i - 2].h) / 2, sl: bars[i - 2].l - a * 0.2, expires: i + p.validBars };
    else if (gapDn && b.c < trend[i] && !p.longOnly) setup = { dir: -1, mid: (b.h + bars[i - 2].l) / 2, sl: bars[i - 2].h + a * 0.2, expires: i + p.validBars };
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
    console.log(`\n════════ ICT/SMC on GOLD ${tf} (${days}d, ${bars.length} bars) ════════`);
    for (const [costName, cost] of [['realistic 0.03%', px * 0.0003], ['tight 0.015%', px * 0.00015]]) {
      console.log(`\n-- cost: ${costName} --`);
      const rows = [];
      for (const rr of [2, 3]) for (const killZone of [true, false]) for (const dispMult of [1.2, 1.6]) for (const longOnly of [true, false])
        rows.push({ fam: 'ICT2022', cfg: `rr${rr}${killZone?'/KZ':''}/disp${dispMult}${longOnly?'/LO':''}`, ...foldEval(bars, simICT2022, { rr, killZone, dispMult, validBars: 12, longOnly }, cost) });
      for (const rr of [2, 3]) for (const killZone of [true, false]) for (const minGap of [0.1, 0.3]) for (const longOnly of [true, false])
        rows.push({ fam: 'FVG', cfg: `rr${rr}${killZone?'/KZ':''}/gap${minGap}${longOnly?'/LO':''}`, ...foldEval(bars, simFVG, { rr, killZone, minGap, validBars: 12, longOnly }, cost) });
      rows.sort((a, b) => b.profitable - a.profitable || b.minPF - a.minPF);
      console.log('model   | config | folds>1 | minPF | totPnL | n | WR | per-fold');
      for (const r of rows.filter(r => r.totN >= 25).slice(0, 8))
        console.log(`${r.fam.padEnd(7)} | ${r.cfg.padEnd(22)} | ${r.profitable}/4 | ${String(r.minPF).padEnd(5)} | ${String(r.totPnl).padStart(6)} | ${r.totN} | ${r.avgWR}% | ${r.perFold}`);
    }
  }
})();
