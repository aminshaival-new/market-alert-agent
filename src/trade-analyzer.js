// World-Class Trader Analysis Engine
// 25+ years of institutional scalping logic encoded as rules.
// Framework: VWAP deviation + RSI momentum + ATR-based levels + trend confluence

function getTrend(close, ema10, sma50) {
  if (close > ema10 && close > sma50)  return { label: 'STRONG BULL', emoji: '🟢', bias: 'LONG' };
  if (close < ema10 && close < sma50)  return { label: 'STRONG BEAR', emoji: '🔴', bias: 'SHORT' };
  if (close > ema10 && close < sma50)  return { label: 'RECOVERING', emoji: '🟡', bias: 'LONG' };
  return { label: 'DISTRIBUTING', emoji: '🟠', bias: 'SHORT' };
}

function getMarketPhase(rsi, close, vwap) {
  const vwapDev = ((close - vwap) / vwap) * 100;
  if (rsi < 30)  return { phase: 'OVERSOLD',    emoji: '⚡', action: 'BOUNCE LONG' };
  if (rsi > 70)  return { phase: 'OVERBOUGHT',   emoji: '🚫', action: 'FADE SHORT' };
  if (rsi > 55 && vwapDev > 0) return { phase: 'MOMENTUM UP',   emoji: '🚀', action: 'BREAKOUT LONG' };
  if (rsi < 45 && vwapDev < 0) return { phase: 'MOMENTUM DOWN', emoji: '💣', action: 'BREAKDOWN SHORT' };
  if (Math.abs(vwapDev) < 0.1) return { phase: 'VWAP MAGNET',   emoji: '🎯', action: 'RANGE TRADE' };
  return { phase: 'CONSOLIDATING', emoji: '⏳', action: 'WAIT' };
}

function calcLevels(direction, close, high, low, atr, vwap) {
  // ATR-based stops: 0.4x ATR for tight scalp stops
  // Targets: 0.8x ATR (1:2 RR automatically)
  const stopDist = atr * 0.4;

  if (direction === 'LONG') {
    const entry  = close;
    // SL below recent swing low or VWAP — whichever is closer
    const swingSL = low - atr * 0.1;
    const vwapSL  = vwap - atr * 0.15;
    const sl      = Math.max(swingSL, vwapSL, entry - stopDist);
    const risk    = entry - sl;
    const target  = entry + risk * 2;            // 1:2 RR
    return { entry, sl, target, risk, rr: 2 };
  } else {
    const entry  = close;
    const swingSL = high + atr * 0.1;
    const vwapSL  = vwap + atr * 0.15;
    const sl      = Math.min(swingSL, vwapSL, entry + stopDist);
    const risk    = sl - entry;
    const target  = entry - risk * 2;            // 1:2 RR
    return { entry, sl, target, risk, rr: 2 };
  }
}

function getConfluenceScore(direction, rsi, close, vwap, ema10, sma50) {
  let score = 0;
  const factors = [];
  if (direction === 'LONG') {
    if (close > vwap)   { score++; factors.push('Price above VWAP'); }
    if (close > ema10)  { score++; factors.push('Price above EMA10'); }
    if (close > sma50)  { score++; factors.push('Price above SMA50'); }
    if (rsi > 50 && rsi < 65) { score++; factors.push('RSI bullish zone (50-65)'); }
    if (rsi < 35)             { score++; factors.push('RSI oversold bounce setup'); }
  } else {
    if (close < vwap)   { score++; factors.push('Price below VWAP'); }
    if (close < ema10)  { score++; factors.push('Price below EMA10'); }
    if (close < sma50)  { score++; factors.push('Price below SMA50'); }
    if (rsi < 50 && rsi > 35) { score++; factors.push('RSI bearish zone (35-50)'); }
    if (rsi > 65)             { score++; factors.push('RSI overbought fade setup'); }
  }
  const quality = score >= 4 ? 'A+ SETUP' : score >= 3 ? 'A SETUP' : score >= 2 ? 'B SETUP' : 'AVOID';
  return { score, factors, quality };
}

function getRiskWarning(quality) {
  if (quality === 'AVOID') return '⛔ Low confluence — skip this trade.';
  if (quality === 'B SETUP') return '⚠️ Moderate setup — reduce position size by 50%.';
  if (quality === 'A SETUP') return '✅ Good setup — standard position size.';
  return '🔥 High conviction — can size up moderately.';
}

function analyze(priceData, symbolName) {
  const { close, open, high, low, change, rsi, vwap, ema10, sma50, atr } = priceData;

  // Fallback ATR if not available (estimate from day range)
  const effectiveATR = atr || (high - low) * 0.6;
  const effectiveVWAP = vwap || close;
  const effectiveEMA  = ema10 || close;
  const effectiveSMA  = sma50 || close;
  const effectiveRSI  = rsi || 50;

  const trend   = getTrend(close, effectiveEMA, effectiveSMA);
  const phase   = getMarketPhase(effectiveRSI, close, effectiveVWAP);
  const direction = trend.bias;
  const levels  = calcLevels(direction, close, high, low, effectiveATR, effectiveVWAP);
  const conf    = getConfluenceScore(direction, effectiveRSI, close, effectiveVWAP, effectiveEMA, effectiveSMA);
  const warning = getRiskWarning(conf.quality);

  return {
    symbol: symbolName,
    direction,
    trend,
    phase,
    levels,
    confluence: conf,
    warning,
    snapshot: { close, open, high, low, change, rsi: effectiveRSI, vwap: effectiveVWAP, atr: effectiveATR }
  };
}

module.exports = { analyze };
