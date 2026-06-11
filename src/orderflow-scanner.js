// ORDERFLOW SCANNER — Gold (PAXG) 15m delta-confirmed breakout
// The only lower-TF strategy that passed 4/4 regime walk-forward at
// realistic costs (backtest/orderflow.js):
//   config: 96-bar range break + taker-delta |z| >= 1.5, BOTH dirs,
//   SL 1.5×ATR, TP 4.5×ATR (RR 3) — minPF 1.05, +677 pts/yr, 325 tr/yr
// Runs every 15m bar close via bot-server scheduler. TradingView can't
// compute taker delta, so this lives here, not in Pine.

const { sendWhatsApp, sendWhatsAppImage } = require('./whatsapp');
const { generateLiveChart } = require('./chart-generator');
const log = require('./logger');

const SYMBOL   = 'PAXGUSDT';
const RANGE    = 96;     // breakout lookback (bars)
const Z_MIN    = 1.5;    // taker-delta z-score threshold
const SL_ATR   = 1.5;
const RR       = 3;
const Z_LOOK   = 50;

let lastSignalBarTime = 0;   // dedupe across scheduler ticks

function rma(src, len) {
  const out = new Array(src.length); let sum = 0;
  for (let i = 0; i < src.length; i++) {
    if (i < len) { sum += src[i]; out[i] = sum / (i + 1); }
    else out[i] = (out[i - 1] * (len - 1) + src[i]) / len;
  }
  return out;
}

async function run() {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=15m&limit=${RANGE + Z_LOOK + 20}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Binance ${res.status}`);
    const data = await res.json();
    // last kline is still open — drop it, work on closed bars
    const bars = data.slice(0, -1).map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], tb: +k[9] }));
    if (bars.length < RANGE + Z_LOOK + 5) return { signal: false };

    const i = bars.length - 1;
    const b = bars[i];
    if (b.t === lastSignalBarTime) return { signal: false };  // already processed

    // ATR(14)
    const tr = bars.map((x, j) => j === 0 ? x.h - x.l :
      Math.max(x.h - x.l, Math.abs(x.h - bars[j - 1].c), Math.abs(x.l - bars[j - 1].c)));
    const atr = rma(tr, 14)[i];

    // taker-delta z-score over Z_LOOK bars
    const delta = bars.map(x => x.tb - (x.v - x.tb));
    let m = 0; for (let j = i - Z_LOOK; j < i; j++) m += delta[j]; m /= Z_LOOK;
    let sd = 0; for (let j = i - Z_LOOK; j < i; j++) sd += (delta[j] - m) ** 2;
    sd = Math.sqrt(sd / Z_LOOK) || 1;
    const z = (delta[i] - m) / sd;

    // 96-bar high/low (excluding current bar)
    let hh = -Infinity, ll = Infinity;
    for (let j = i - RANGE; j < i; j++) { hh = Math.max(hh, bars[j].h); ll = Math.min(ll, bars[j].l); }

    const buySignal  = b.c > hh && z >= Z_MIN;
    const sellSignal = b.c < ll && z <= -Z_MIN;
    if (!buySignal && !sellSignal) return { signal: false };

    lastSignalBarTime = b.t;
    const dir   = buySignal ? 1 : -1;
    const entry = b.c;
    const sl = entry - dir * atr * SL_ATR;
    const tp = entry + dir * atr * SL_ATR * RR;
    const ist = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

    const emoji   = buySignal ? '🟢' : '🔴';
    const action  = buySignal ? 'BUY' : 'SELL';
    const flowTxt = buySignal
      ? `96-bar high broken with aggressive buy flow (delta z=+${z.toFixed(1)}σ — strong taker buying)`
      : `96-bar low broken with aggressive sell flow (delta z=${z.toFixed(1)}σ — strong taker selling)`;

    const msg =
      `${emoji} *GOLD ORDERFLOW ${action}*\n_${ist} IST · Delta Breakout 15m_\n\n` +
      `*Entry*  $${entry.toFixed(2)}\n` +
      `*SL*     $${sl.toFixed(2)}  _(1.5×ATR)_\n` +
      `*TP*     $${tp.toFixed(2)}  _(RR 1:3)_\n\n` +
      `*Why:* ${flowTxt}\n\n` +
      `_Validated: 4/4 regimes profitable, 1yr walk-forward_\n` +
      `_⚠️ Verify before entry. Not financial advice._`;

    log.info(`[Orderflow] GOLD ${action} signal @ ${entry} (z=${z.toFixed(2)})`);

    try {
      const chart = await generateLiveChart('GOLD', '15');
      await sendWhatsAppImage(chart, `${emoji} GOLD Delta Breakout ${action} | Entry $${entry.toFixed(2)} | SL $${sl.toFixed(2)} | TP $${tp.toFixed(2)}`);
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) { log.error('[Orderflow] Chart failed: ' + e.message); }

    await sendWhatsApp(msg);
    return { signal: true, action, entry, sl, tp, z };
  } catch (e) {
    log.error('[Orderflow] Scanner error: ' + e.message);
    return { signal: false, error: e.message };
  }
}

if (require.main === module) {
  run().then(r => { console.log(JSON.stringify(r)); process.exit(0); });
}

module.exports = { run };
