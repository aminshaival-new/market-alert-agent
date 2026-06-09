// Chartink.com Scanner — Pre-filters Indian F&O stocks before QUAD CONFLUENCE
// Uses Chartink's free screener API to find technically strong setups
// Then ATLAS PRO applies full 5-factor scoring on the filtered list

const log = require('./logger');

// ── Chartink scan clauses (QUAD CONFLUENCE pre-filter) ────────────────────────

// BULLISH: RSI momentum + price above VWAP + ADX trending + volume surge
const BULLISH_SCAN = `( [0] 1 day rsi( 14 ) > 55 and [0] 1 day rsi( 14 ) < 75 and [0] 1 day close > [0] 1 day vwap and [0] 1 day adx( 14 ) > 20 and [0] 1 day volume > [0] 1 day ema( volume , 20 ) )`;

// BEARISH: RSI falling + price below VWAP + ADX trending + volume surge
const BEARISH_SCAN = `( [0] 1 day rsi( 14 ) < 45 and [0] 1 day rsi( 14 ) > 25 and [0] 1 day close < [0] 1 day vwap and [0] 1 day adx( 14 ) > 20 and [0] 1 day volume > [0] 1 day ema( volume , 20 ) )`;

// ── Fetch CSRF token from Chartink ────────────────────────────────────────────
async function getCsrfToken() {
  const res = await fetch('https://chartink.com/screener/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml'
    },
    signal: AbortSignal.timeout(10000)
  });

  if (!res.ok) throw new Error(`Chartink CSRF fetch failed: ${res.status}`);

  const html    = await res.text();
  const match   = html.match(/meta\s+name="csrf-token"\s+content="([^"]+)"/);
  const csrf    = match ? match[1] : '';
  const cookies = res.headers.get('set-cookie') || '';

  // Extract the session cookie
  const sessionCookie = cookies.split(',')
    .map(c => c.split(';')[0].trim())
    .filter(c => c.includes('='))
    .join('; ');

  return { csrf, cookies: sessionCookie };
}

// ── Run a Chartink scan ───────────────────────────────────────────────────────
async function runChartinkScan(scanClause) {
  const { csrf, cookies } = await getCsrfToken();

  const res = await fetch('https://chartink.com/screener/process', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Csrf-Token': csrf,
      'Cookie':       cookies,
      'User-Agent':   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer':      'https://chartink.com/screener/',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json'
    },
    body: `scan_clause=${encodeURIComponent(scanClause)}`,
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) throw new Error(`Chartink scan failed: ${res.status}`);

  const json = await res.json();
  const stocks = (json.data || []).map(s => s.nsecode).filter(Boolean);
  return stocks;
}

// ── Get pre-filtered F&O symbols ─────────────────────────────────────────────
async function getChartinkSignals() {
  log.info('[Chartink] Running pre-filter scans...');

  let bullish = [], bearish = [];

  try {
    bullish = await runChartinkScan(BULLISH_SCAN);
    log.info(`[Chartink] Bullish candidates: ${bullish.length} stocks`);
  } catch (e) {
    log.error('[Chartink] Bullish scan failed: ' + e.message);
  }

  try {
    bearish = await runChartinkScan(BEARISH_SCAN);
    log.info(`[Chartink] Bearish candidates: ${bearish.length} stocks`);
  } catch (e) {
    log.error('[Chartink] Bearish scan failed: ' + e.message);
  }

  // Convert to TradingView NSE format
  const toTV = sym => `NSE:${sym}`;

  return {
    bullish: bullish.map(toTV),
    bearish: bearish.map(toTV),
    all:     [...new Set([...bullish, ...bearish])].map(toTV)
  };
}

module.exports = { getChartinkSignals, BULLISH_SCAN, BEARISH_SCAN };
