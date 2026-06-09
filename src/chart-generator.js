// Chart Generator — Multi-service with automatic fallback
// Priority: 1) ChartImg (real TradingView chart) → 2) QuickChart (custom) → 3) null
// No npm deps, Node 18+ native fetch

const settings = require('../config/settings.json');

// ── Service 1: ChartImg.com — Real TradingView charts ────────────────────────
async function generateChartImg(analysis) {
  const apiKey = process.env.CHARTIMG_KEY || settings.chartimg?.apiKey;
  if (!apiKey || apiKey.startsWith('SET_VIA') || apiKey === '') return null;

  const { symbol, direction, snapshot } = analysis;

  // Map our symbol names to TradingView symbols for ChartImg
  const tvSymMap = {
    'Nifty 50':         'NSE:NIFTY',
    'Bank Nifty':       'NSE:BANKNIFTY',
    'XAU/USD (Gold)':   'TVC:GOLD',
    'XAG/USD (Silver)': 'TVC:SILVER',
    'BTC/USD (Bitcoin)':'BITSTAMP:BTCUSD',
    'Crude Oil (WTI)':  'TVC:USOIL',
    'USD/INR':          'FX_IDC:USDINR',
    'EUR/USD':          'FX:EURUSD',
    'Reliance (RIL)':   'NSE:RELIANCE',
  };

  const tvSymbol = tvSymMap[symbol] ||
    (symbol.includes(':') ? symbol : `NSE:${symbol}`);

  // ChartImg API — generates actual TradingView screenshot
  const params = new URLSearchParams({
    symbol:   tvSymbol,
    interval: '15',         // 15-minute chart for scalping
    theme:    'dark',
    studies:  'RSI@tv-basicstudies,VWAP@tv-basicstudies',
    width:    '800',
    height:   '450',
    key:      apiKey
  });

  const res = await fetch(
    `https://api.chart-img.com/v1/tradingview/advanced-chart?${params}`,
    { signal: AbortSignal.timeout(15000) }
  );

  if (!res.ok) throw new Error(`ChartImg error: ${res.status}`);

  // ChartImg returns the PNG image directly — we need to upload to get a URL
  // For WhatsApp: we'll download and re-upload via base64 (handled in whatsapp.js)
  // Return the URL directly — works with sendWhatsAppImage which downloads then base64s
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('image')) throw new Error('ChartImg did not return an image');

  // Save to temp buffer and create a data URL
  const buf  = await res.arrayBuffer();
  const b64  = Buffer.from(buf).toString('base64');
  // Return as data URI — whatsapp.js will detect and skip download step
  return `data:image/png;base64,${b64}`;
}

// ── Service 2: QuickChart.io — Custom level chart ─────────────────────────────
async function generateQuickChart(analysis) {
  const { symbol, direction, levels, snapshot, confluence, phase } = analysis;
  const { entry, sl, target } = levels;
  const { close, high, low, rsi, vwap, atr } = snapshot;

  const allPrices = [sl, entry, target, high, low];
  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const pad  = (maxP - minP) * 0.4;
  const yMin = minP - pad;
  const yMax = maxP + pad;

  const isLong = direction === 'LONG';
  const dp     = entry > 100 ? 2 : 4;
  const fmt    = v => Number(v).toFixed(dp);

  const GREEN  = 'rgba(38,166,154,1)';
  const RED    = 'rgba(239,83,80,1)';
  const YELLOW = 'rgba(255,235,59,1)';

  const xs = ['', 'Level', 'Zone', 'Price', ''];

  function flatLine(value, color, label, dash = []) {
    return {
      label, data: xs.map(() => value),
      borderColor: color, borderWidth: dash.length ? 2 : 3,
      borderDash: dash, pointRadius: 0, fill: false, tension: 0
    };
  }

  const chartConfig = {
    type: 'line',
    data: {
      labels: xs,
      datasets: [
        flatLine(target, GREEN,  `Target: ${fmt(target)}`),
        flatLine(entry,  YELLOW, `Entry:  ${fmt(entry)}`),
        flatLine(sl,     RED,    `SL:     ${fmt(sl)}`),
        flatLine(vwap,   'rgba(147,112,219,0.9)', `VWAP: ${fmt(vwap)}`, [4, 4]),
        {
          label: `Current: ${fmt(close)}`,
          data: xs.map(() => close),
          borderColor: 'rgba(255,255,255,0.9)',
          borderWidth: 2, borderDash: [6, 3], pointRadius: 0, fill: false
        },
        {
          label: isLong ? 'Profit Zone' : 'Profit Zone',
          data: xs.map(() => isLong ? target : entry),
          borderColor: 'transparent',
          backgroundColor: 'rgba(38,166,154,0.15)',
          fill: isLong ? '+1' : '-1', pointRadius: 0, tension: 0
        },
        {
          label: 'Entry Anchor', data: xs.map(() => entry),
          borderColor: 'transparent', backgroundColor: 'transparent',
          fill: false, pointRadius: 0
        }
      ]
    },
    options: {
      responsive: false, animation: false,
      layout: { padding: { top: 20, bottom: 10, left: 10, right: 20 } },
      legend: {
        display: true, position: 'right',
        labels: { fontColor: 'white', fontSize: 13, fontStyle: 'bold', padding: 12, boxWidth: 20,
          filter: item => !item.text.includes('Anchor') }
      },
      title: {
        display: true,
        text: [
          `${symbol}  |  ${isLong ? '▲ LONG' : '▼ SHORT'} SCALP  |  RR 1:2.5`,
          `${phase.emoji} ${phase.phase}  |  RSI: ${rsi?.toFixed(1)}  |  ATR: ${fmt(atr)}  |  ${confluence.quality}`
        ],
        fontColor: 'white', fontSize: 15, fontStyle: 'bold', padding: 14
      },
      scales: {
        xAxes: [{ display: false }],
        yAxes: [{
          ticks: { fontColor: 'rgba(200,200,200,0.8)', fontSize: 12, min: yMin, max: yMax,
            callback: v => fmt(v) },
          gridLines: { color: 'rgba(255,255,255,0.08)', zeroLineColor: 'rgba(255,255,255,0.15)' }
        }]
      }
    }
  };

  const res = await fetch('https://quickchart.io/chart/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      backgroundColor: '#131722',
      width: 900, height: 500, devicePixelRatio: 1.5, format: 'png',
      chart: chartConfig
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) throw new Error(`QuickChart error: ${res.status}`);
  const json = await res.json();
  return json.url;
}

// ── Main export: tries ChartImg first, falls back to QuickChart ───────────────
async function generateTradeChart(analysis) {
  // Try ChartImg first (real TradingView chart)
  try {
    const url = await generateChartImg(analysis);
    if (url) {
      console.log('[Chart] ChartImg ✅');
      return url;
    }
  } catch (e) {
    console.log('[Chart] ChartImg failed:', e.message, '→ falling back to QuickChart');
  }

  // Fallback: QuickChart custom chart
  try {
    const url = await generateQuickChart(analysis);
    console.log('[Chart] QuickChart ✅');
    return url;
  } catch (e) {
    throw new Error(`All chart services failed. QuickChart: ${e.message}`);
  }
}

module.exports = { generateTradeChart };
