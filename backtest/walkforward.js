#!/usr/bin/env node
// Walk-forward validation: optimize on one window, validate on the NEXT
// unseen window. The only honest test of a parameterized strategy.
// Gold proxy: PAXGUSDT (gold-backed token, tracks spot 1:1, full history)
// Usage: node backtest/walkforward.js

const { simulate, fetchBinance } = require('./backtest');

const GRID = [];
for (const adxMin of [18, 21, 24, 28])
  for (const slBuf of [0.4, 0.6, 0.9])
    for (const tp1R of [1.0, 1.5])
      for (const tp2R of [2.0, 3.0])
        for (const setups of [['both', true, true], ['pb', true, false], ['swp', false, true]])
          GRID.push({ adxMin, slBuf, tp1R, tp2R, setupName: setups[0], usePullback: setups[1], useSweep: setups[2] });

function runGrid(bars, cost, minTrades) {
  const out = [];
  for (const g of GRID) {
    const p = { ...g, cooldown: 10, maxSpreadAtr: 2.5, minSep: 0.25, minPierce: 0.3, wickRatio: 0.5, huntBars: 8, useVol: true, session: false, cost };
    const r = simulate(bars, p);
    if (r.n >= minTrades) out.push({ ...g, ...r });
  }
  out.sort((a, b) => b.pf - a.pf);
  return out;
}

function evalConfig(bars, g, cost) {
  const p = { ...g, cooldown: 10, maxSpreadAtr: 2.5, minSep: 0.25, minPierce: 0.3, wickRatio: 0.5, huntBars: 8, useVol: true, session: false, cost };
  return simulate(bars, p);
}

function median(arr) { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; }

async function walkForward(name, symbol, days, costFn) {
  console.log(`\n════════ WALK-FORWARD: ${name} ════════`);
  const bars = await fetchBinance(symbol, '15m', days);
  console.log(`${bars.length} bars: ${new Date(bars[0].t).toISOString().slice(0,10)} → ${new Date(bars[bars.length-1].t).toISOString().slice(0,10)}`);
  const cost = costFn(bars[bars.length - 1].c);

  // 4 folds of ~90 days: optimize fold i → test fold i+1
  const foldSize = Math.floor(bars.length / 4);
  let oosResults = [];
  for (let f = 0; f < 3; f++) {
    const train = bars.slice(f * foldSize, (f + 1) * foldSize + 60);   // +60 bar warmup overlap
    const test  = bars.slice((f + 1) * foldSize, (f + 2) * foldSize + 60);
    const ranked = runGrid(train, cost, 8);
    if (!ranked.length) { console.log(`Fold ${f + 1}: no configs with enough trades`); continue; }
    const best = ranked[0];
    const oos  = evalConfig(test, best, cost);
    oosResults.push(oos.pf);
    console.log(`Fold ${f + 1}: IN-SAMPLE best [${best.setupName} ADX${best.adxMin} sl${best.slBuf} tp${best.tp1R}/${best.tp2R}] PF=${best.pf} (${best.n}tr ${best.wr}%) → OUT-OF-SAMPLE PF=${oos.pf} (${oos.n}tr ${oos.wr}% pnl=${oos.pnl})`);
  }

  // Robustness: how does the WHOLE config family do over the full year?
  const fullRanked = runGrid(bars, cost, 30);
  const pfs = fullRanked.map(r => r.pf);
  console.log(`\nFull-period (${days}d) config family: ${fullRanked.length} configs ≥30 trades`);
  console.log(`  PF — median: ${median(pfs).toFixed(2)} | best: ${(pfs[0]||0).toFixed(2)} | % profitable: ${(100*pfs.filter(p=>p>1).length/Math.max(pfs.length,1)).toFixed(0)}%`);
  if (fullRanked[0]) {
    const b = fullRanked[0];
    console.log(`  Best full-period: [${b.setupName} ADX${b.adxMin} sl${b.slBuf} tp${b.tp1R}/${b.tp2R}] PF=${b.pf} WR=${b.wr}% n=${b.n} pnl=${b.pnl} maxDD=${b.maxDD}`);
  }
  const oosMedian = median(oosResults);
  console.log(`\nVERDICT: median OUT-OF-SAMPLE PF = ${oosMedian.toFixed(2)} ${oosMedian >= 1.15 ? '✅ edge survives validation' : oosMedian >= 0.95 ? '⚠️ breakeven — no reliable edge' : '❌ NO EDGE — strategy fails out-of-sample'}`);
  return oosMedian;
}

(async () => {
  try {
    await walkForward('GOLD (PAXG/USDT proxy, 1 year, 15m)', 'PAXGUSDT', 360, c => c * 0.0008);
    await walkForward('BTCUSD (1 year, 15m)', 'BTCUSDT', 360, c => c * 0.0006);
  } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
})();
