// TradingView Scanner API — fetches live prices
async function fetchPrices(symbols) {
  // symbols: array of strings like ['NSE:NIFTY', 'NSE:RELIANCE']
  const body = {
    symbols: { tickers: symbols, query: { types: [] } },
    columns: ['close', 'open', 'high', 'low', 'change', 'volume', 'RSI', 'VWAP']
  };

  const res = await fetch('https://scanner.tradingview.com/global/scan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error(`TradingView API error: ${res.status}`);
  const data = await res.json();

  const result = {};
  for (const item of data.data || []) {
    const [close, open, high, low, change, volume, rsi, vwap] = item.d;
    result[item.s] = { close, open, high, low, change, volume, rsi, vwap };
  }
  return result;
}

function arrow(change) {
  if (change > 0.5)  return '🟢▲';
  if (change < -0.5) return '🔴▼';
  return '🟡─';
}

function fmt(val, decimals = 2) {
  if (val == null) return 'N/A';
  return Number(val).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

module.exports = { fetchPrices, arrow, fmt };
