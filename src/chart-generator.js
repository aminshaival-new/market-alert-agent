// Chart Generator — QuickChart.io (free, no npm deps, dark TradingView theme)
// Returns a hosted PNG URL for WhatsApp sending

async function generateTradeChart(analysis) {
  const { symbol, direction, levels, snapshot, confluence, phase } = analysis;
  const { entry, sl, target, risk } = levels;
  const { close, open, high, low, rsi, vwap, atr } = snapshot;

  // Price axis range with padding
  const allPrices = [sl, entry, target, high, low];
  const minP  = Math.min(...allPrices);
  const maxP  = Math.max(...allPrices);
  const pad   = (maxP - minP) * 0.4;
  const yMin  = minP - pad;
  const yMax  = maxP + pad;

  const isLong  = direction === 'LONG';
  const dp      = entry > 100 ? 2 : 4;   // decimal places (gold=2, forex=4)
  const fmt     = v => Number(v).toFixed(dp);

  // Color scheme: TradingView dark
  const GREEN  = 'rgba(38,166,154,1)';
  const RED    = 'rgba(239,83,80,1)';
  const YELLOW = 'rgba(255,235,59,1)';
  const GRAY   = 'rgba(150,150,150,0.4)';

  // Build 5 dummy x-points to anchor horizontal levels
  const xs = ['', 'Level', 'Zone', 'Price', ''];

  // Dataset for each level as a flat horizontal line
  function flatLine(value, color, label, dash = []) {
    return {
      label,
      data: xs.map(() => value),
      borderColor: color,
      borderWidth: dash.length ? 2 : 3,
      borderDash: dash,
      pointRadius: 0,
      fill: false,
      tension: 0
    };
  }

  // Fill zone between entry and target (profit zone)
  const profitZone = {
    label: isLong ? 'Profit Zone' : 'Profit Zone',
    data: xs.map(() => isLong ? target : entry),
    borderColor: 'transparent',
    backgroundColor: 'rgba(38,166,154,0.15)',
    fill: isLong ? '+1' : '-1',
    pointRadius: 0,
    tension: 0
  };

  const entryAnchor = {
    label: 'Entry Anchor',
    data: xs.map(() => entry),
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    fill: false,
    pointRadius: 0
  };

  // Current price as bold line
  const currentLine = {
    label: `Current: ${fmt(close)}`,
    data: xs.map(() => close),
    borderColor: 'rgba(255,255,255,0.9)',
    borderWidth: 2,
    borderDash: [6, 3],
    pointRadius: 0,
    fill: false
  };

  const chartConfig = {
    type: 'line',
    data: {
      labels: xs,
      datasets: [
        flatLine(target, GREEN,  `Target: ${fmt(target)}`),
        flatLine(entry,  YELLOW, `Entry:  ${fmt(entry)}`),
        flatLine(sl,     RED,    `SL:     ${fmt(sl)}`),
        flatLine(vwap,   'rgba(147,112,219,0.9)', `VWAP: ${fmt(vwap)}`, [4, 4]),
        currentLine,
        profitZone,
        entryAnchor
      ]
    },
    options: {
      responsive: false,
      animation: false,
      layout: { padding: { top: 20, bottom: 10, left: 10, right: 20 } },
      legend: {
        display: true,
        position: 'right',
        labels: {
          fontColor: 'white',
          fontSize: 13,
          fontStyle: 'bold',
          padding: 12,
          boxWidth: 20,
          filter: item => !item.text.includes('Anchor')
        }
      },
      title: {
        display: true,
        text: [
          `${symbol}  |  ${isLong ? '▲ LONG' : '▼ SHORT'} SCALP  |  RR 1:2`,
          `${phase.emoji} ${phase.phase}  |  RSI: ${rsi.toFixed(1)}  |  ATR: ${fmt(atr)}  |  ${confluence.quality}`
        ],
        fontColor: 'white',
        fontSize: 15,
        fontStyle: 'bold',
        padding: 14
      },
      scales: {
        xAxes: [{ display: false }],
        yAxes: [{
          ticks: {
            fontColor: 'rgba(200,200,200,0.8)',
            fontSize: 12,
            min: yMin,
            max: yMax,
            callback: v => fmt(v)
          },
          gridLines: { color: 'rgba(255,255,255,0.08)', zeroLineColor: 'rgba(255,255,255,0.15)' }
        }]
      },
      plugins: {
        backgroundImageColor: { color: '#131722' }
      }
    }
  };

  // POST to QuickChart to get a short hosted URL
  const res = await fetch('https://quickchart.io/chart/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      backgroundColor: '#131722',
      width: 900,
      height: 500,
      devicePixelRatio: 1.5,
      format: 'png',
      chart: chartConfig
    })
  });

  if (!res.ok) throw new Error(`QuickChart error: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.url;   // e.g. https://quickchart.io/chart/render/9a560ba3-...
}

module.exports = { generateTradeChart };
