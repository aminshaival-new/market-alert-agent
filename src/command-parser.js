// Natural language command parser for WhatsApp bot
// Understands casual Indian trader language

const SYMBOL_MAP = {
  // Indices
  'nifty 50': 'NIFTY', 'nifty50': 'NIFTY', 'nifty': 'NIFTY',
  'banknifty': 'BANKNIFTY', 'bank nifty': 'BANKNIFTY', 'bnf': 'BANKNIFTY',
  'sensex': 'SENSEX', 'giftnifty': 'GIFTNIFTY', 'gift nifty': 'GIFTNIFTY',
  // Metals
  'gold': 'XAUUSD', 'xauusd': 'XAUUSD', 'xau': 'XAUUSD',
  'silver': 'SILVER', 'xagusd': 'SILVER', 'xag': 'SILVER',
  // Crypto
  'bitcoin': 'BTCUSD', 'btc': 'BTCUSD', 'btcusd': 'BTCUSD',
  'ethereum': 'ETHUSD', 'eth': 'ETHUSD', 'ethusd': 'ETHUSD',
  // Energy
  'crude': 'CRUDE', 'crude oil': 'CRUDE', 'oil': 'CRUDE', 'wti': 'CRUDE',
  // Forex — majors
  'usdinr': 'USDINR', 'dollar': 'USDINR', 'usd inr': 'USDINR',
  'eurusd': 'EURUSD', 'euro': 'EURUSD', 'eur usd': 'EURUSD',
  'gbpusd': 'GBPUSD', 'pound': 'GBPUSD', 'gbp usd': 'GBPUSD', 'cable': 'GBPUSD',
  'usdjpy': 'USDJPY', 'usd jpy': 'USDJPY', 'dollar yen': 'USDJPY', 'yen': 'USDJPY',
  'audusd': 'AUDUSD', 'aud usd': 'AUDUSD', 'aussie': 'AUDUSD',
  'usdcad': 'USDCAD', 'usd cad': 'USDCAD', 'loonie': 'USDCAD',
  'usdchf': 'USDCHF', 'usd chf': 'USDCHF', 'swissy': 'USDCHF',
  'nzdusd': 'NZDUSD', 'nzd usd': 'NZDUSD', 'kiwi': 'NZDUSD',
  // Forex — crosses
  'gbpjpy': 'GBPJPY', 'gbp jpy': 'GBPJPY', 'pound yen': 'GBPJPY',
  'eurjpy': 'EURJPY', 'eur jpy': 'EURJPY', 'euro yen': 'EURJPY',
  'gbpaud': 'GBPAUD', 'gbp aud': 'GBPAUD',
  'eurgbp': 'EURGBP', 'eur gbp': 'EURGBP',
  'eurcad': 'EURCAD', 'eur cad': 'EURCAD',
  'audcad': 'AUDCAD', 'aud cad': 'AUDCAD',
  'audnzd': 'AUDNZD', 'aud nzd': 'AUDNZD',
  'cadjpy': 'CADJPY', 'cad jpy': 'CADJPY',
  'audjpy': 'AUDJPY', 'aud jpy': 'AUDJPY',
  // Top F&O stocks (common names)
  'reliance': 'RELIANCE', 'ril': 'RELIANCE',
  'tcs': 'TCS',
  'infosys': 'INFY', 'infy': 'INFY',
  'hdfc bank': 'HDFCBANK', 'hdfcbank': 'HDFCBANK', 'hdfc': 'HDFCBANK',
  'icici': 'ICICIBANK', 'icici bank': 'ICICIBANK', 'icicibank': 'ICICIBANK',
  'sbi': 'SBIN', 'state bank': 'SBIN',
  'wipro': 'WIPRO',
  'hcl': 'HCLTECH', 'hcltech': 'HCLTECH',
  'axis bank': 'AXISBANK', 'axisbank': 'AXISBANK', 'axis': 'AXISBANK',
  'kotak': 'KOTAKBANK', 'kotakbank': 'KOTAKBANK', 'kotak bank': 'KOTAKBANK',
  'bajaj finance': 'BAJFINANCE', 'bajfinance': 'BAJFINANCE', 'bajaj fin': 'BAJFINANCE',
  'maruti': 'MARUTI', 'maruti suzuki': 'MARUTI',
  'tata motors': 'TATAMOTORS', 'tatamotors': 'TATAMOTORS',
  'adani': 'ADANIENT', 'adani ent': 'ADANIENT',
  'airtel': 'BHARTIARTL', 'bharti airtel': 'BHARTIARTL', 'bhartiartl': 'BHARTIARTL',
  'ongc': 'ONGC',
  'ntpc': 'NTPC',
  'sunpharma': 'SUNPHARMA', 'sun pharma': 'SUNPHARMA',
  'titan': 'TITAN',
  'asian paints': 'ASIANPAINT', 'asianpaint': 'ASIANPAINT',
  'lt': 'LT', 'larsen': 'LT', 'l&t': 'LT',
  'powergrid': 'POWERGRID', 'power grid': 'POWERGRID',
  'techm': 'TECHM', 'tech mahindra': 'TECHM',
  'zomato': 'ZOMATO',
  'irctc': 'IRCTC',
};

function extractSymbol(text) {
  // Sort by length desc so "bank nifty" matches before "nifty"
  const keys = Object.keys(SYMBOL_MAP).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (text.includes(key)) return SYMBOL_MAP[key];
  }
  // Try uppercase word match (e.g. "HDFCBANK")
  const words = text.toUpperCase().match(/\b[A-Z]{3,12}\b/g) || [];
  for (const w of words) {
    if (SYMBOL_MAP[w.toLowerCase()]) return SYMBOL_MAP[w.toLowerCase()];
  }
  return null;
}

function parseCommand(rawText) {
  // Normalize: remove slashes so "GBP/JPY" → "gbpjpy", "EUR/USD" → "eurusd"
  const text = rawText.toLowerCase().trim().replace(/([a-z]{2,4})\/([a-z]{2,4})/g, '$1$2');

  // ── HELP ────────────────────────────────────────────────────────────────────
  if (/\b(help|hi|hello|hey|menu|commands|what can|start)\b/.test(text)) {
    return { type: 'HELP' };
  }

  // ── LIST ALERTS ─────────────────────────────────────────────────────────────
  if (/\b(list|show|my).{0,10}alert|alert.{0,10}(list|status|active)\b/.test(text)) {
    return { type: 'LIST_ALERTS' };
  }

  // ── ADD ALERT — "alert me if nifty crosses above 23500" ────────────────────
  const alertRx = /alert.{0,30}?(above|below|crosses above|crosses below)\s*([\d.,]+)/;
  const alertM  = text.match(alertRx);
  if (alertM) {
    const sym = extractSymbol(text);
    if (sym) {
      const cond  = alertM[1].replace('crosses ', '');
      const price = parseFloat(alertM[2].replace(',', ''));
      return { type: 'ADD_ALERT', symbol: sym, condition: cond, price };
    }
  }

  // ── MORNING BRIEFING ────────────────────────────────────────────────────────
  if (/\b(morning|briefing|daily update|market update|market summary|overview|good morning)\b/.test(text)) {
    return { type: 'BRIEFING' };
  }

  // ── FULL SCAN ───────────────────────────────────────────────────────────────
  if (/\b(scan|fo scan|f&o scan|signals|opportunities|what.*buy|best.*stock|top.*pick|screen|recommend|top \d|give.*top|which.*trade|stock.*today|trade.*today|f&o.*stock|fo.*stock|nse.*stock|buy.*today|sell.*today|best.*trade|market.*opportunit|what.*trade|portfolio|watchlist)\b/.test(text)) {
    return { type: 'SCAN' };
  }

  // ── SCALP / TRADE IDEA ──────────────────────────────────────────────────────
  // "Give me scalping idea for RIL"
  // "Trade idea on gold"
  // "Nifty scalp"
  // "What to do with HDFC Bank"
  if (/\b(scalp|scalping|trade|idea|signal|setup|buy|sell|call|put|entry|analysis|what to do|suggest|recommend)\b/.test(text)) {
    const sym = extractSymbol(text);
    if (sym) return { type: 'SCALP', symbol: sym };
  }

  // ── PRICE CHECK ─────────────────────────────────────────────────────────────
  if (/\b(price|rate|current|value|how much|quote|ltp)\b/.test(text)) {
    const sym = extractSymbol(text);
    if (sym) return { type: 'PRICE', symbol: sym };
  }

  // ── Symbol only (just "NIFTY" or "RIL") ─────────────────────────────────────
  const sym = extractSymbol(text);
  if (sym) return { type: 'SCALP', symbol: sym };

  return { type: 'UNKNOWN' };
}

module.exports = { parseCommand, SYMBOL_MAP };
