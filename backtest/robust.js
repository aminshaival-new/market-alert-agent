#!/usr/bin/env node
// Robustness check: evaluate FIXED configs on every fold separately.
// A real edge should be profitable in most regimes with ONE setting.
// Usage: node backtest/robust.js

const { fetchBinance } = require('./backtest');
const { simDonchian, simPullback1H } = require('./gold1h');

(async () => {
  const bars = await fetchBinance('PAXGUSDT', '1h', 1080);
  const cost = bars[bars.length - 1].c * 0.0003;
  const foldSize = Math.floor(bars.length / 4);
  const folds = [0, 1, 2, 3].map(f => bars.slice(f * foldSize, (f + 1) * foldSize + 100));

  console.log(`GOLD 1H — fixed-config robustness across 4 folds (~9 months each)`);
  console.log(`folds: ${folds.map(f => new Date(f[0].t).toISOString().slice(0,7)).join(' | ')}\n`);

  const candidates = [];
  for (const len of [48, 96, 144]) for (const trailMult of [2, 3, 4]) for (const slMult of [2.5]) for (const longOnly of [false, true])
    candidates.push({ name: `Donchian len${len} trail${trailMult}${longOnly ? ' LONG-ONLY' : ''}`, sim: simDonchian, p: { len, trailMult, slMult, adxMin: 0, longOnly } });
  for (const adxMin of [18, 22]) for (const slBuf of [1.0]) for (const tp1R of [1.5]) for (const tp2R of [2.0, 3.0])
    candidates.push({ name: `Pullback1H adx${adxMin} tp${tp1R}/${tp2R}`, sim: simPullback1H, p: { adxMin, slBuf, tp1R, tp2R } });

  const rows = [];
  for (const c of candidates) {
    const pfs = folds.map(f => c.sim(f, { ...c.p, cost }));
    const profitable = pfs.filter(r => r.pf > 1).length;
    const totPnl = pfs.reduce((s, r) => s + r.pnl, 0);
    const totN = pfs.reduce((s, r) => s + r.n, 0);
    rows.push({ name: c.name, folds: pfs.map(r => `${r.pf}(${r.n})`).join('  '), profitable, totPnl: +totPnl.toFixed(0), totN });
  }
  rows.sort((a, b) => b.profitable - a.profitable || b.totPnl - a.totPnl);
  console.log('config | PF(trades) per fold | folds>1 | total PnL | trades');
  for (const r of rows)
    console.log(`${r.name.padEnd(32)} | ${r.folds.padEnd(44)} | ${r.profitable}/4 | ${String(r.totPnl).padStart(7)} | ${r.totN}`);
})();
