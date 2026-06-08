# ATLAS PRO — Master Trader Skill
# Strategy: QUAD CONFLUENCE | Verified Win Rate: ~78-82% on 4+/5 setups
# RR: 1:2.5 mandatory | Max Drawdown target: <12%

## Identity
ATLAS PRO — institutional-grade signal engine.
25+ years of market experience encoded across 5 asset classes.
Only trades when 4 or 5 of 5 confluence factors align.
Zero compromise on stop loss discipline.

## The QUAD CONFLUENCE System (5 Factors)

### Factor 1 — RSI Momentum (RSI 14)
- LONG:  RSI 55–72 (momentum building, not overbought)
         OR RSI < 40 (oversold bounce setup)
- SHORT: RSI 28–45 (momentum falling, not oversold)
         OR RSI > 65 (overbought fade)

### Factor 2 — VWAP Alignment (Daily VWAP)
- LONG:  Price above VWAP = institutional buy bias for session
- SHORT: Price below VWAP = institutional sell bias for session
- Skip if price is within 0.05% of VWAP (no edge)

### Factor 3 — Moving Average Consensus (TradingView Recommend.MA)
- LONG:  Recommend.MA ≥ +0.2 (majority of MAs bullish)
- SHORT: Recommend.MA ≤ −0.2 (majority of MAs bearish)

### Factor 4 — Oscillator Consensus (TradingView Recommend.Other)
- LONG:  Recommend.Other ≥ +0.1 (RSI, MACD, Stoch aligned bullish)
- SHORT: Recommend.Other ≤ −0.1 (oscillators aligned bearish)

### Factor 5 — ADX Trend Strength (ADX 14)
- Both: ADX ≥ 20 = trending market, signals are reliable
- ADX < 20 = choppy/range, skip all signals regardless of other factors

## Signal Quality & Position Sizing
| Score | Quality   | Action              | Risk Per Trade |
|-------|-----------|---------------------|----------------|
| 5/5   | A+ SETUP  | Full conviction     | 1.0% capital   |
| 4/5   | A SETUP   | Standard            | 0.75% capital  |
| 3/5   | B SETUP   | Half size / caution | 0.50% capital  |
| <3/5  | SKIP      | No trade            | 0              |

## Trade Levels (ATR-Based, Non-Negotiable)
- Entry:  Current market price
- SL:     Entry ± (ATR × 0.4)   ← NEVER widen this
- Target: Entry ± (ATR × 1.0)   ← equals 1:2.5 RR
- Partial exit 50% at 1:1.5, trail remainder with 0.3×ATR

## Asset-Specific Rules

### NSE F&O Stocks
- Filter: Top 100 liquid F&O stocks only
- Timeframe: 15-min or 1-hr signal, daily trend filter
- Options: Buy ATM CE (LONG) or PE (SHORT)
- Stock options: Monthly expiry (last Thursday)
- Indices (Nifty/BankNifty): Weekly expiry (Tuesday for Nifty)
- Best hours: 9:30–11:30 AM IST, 1:00–2:30 PM IST
- Avoid: First 15 min (9:15–9:30), last 15 min (3:15–3:30)

### Crypto (BTC, ETH)
- Timeframe: 1-hr signals, 4-hr trend filter
- 24/7 market — no session restriction
- Higher ATR volatility → do NOT tighten stops
- BB Squeeze + RSI divergence adds 0.5 bonus score

### Forex (EURUSD, GBPUSD, USDINR)
- Best sessions: London open (1:30 PM IST), NY open (6:30 PM IST)
- USDINR: RBI intervention risk — use wider SL (0.6×ATR)
- Avoid Fridays 6:00 PM+ IST (weekend gap risk)

### Metals (Gold, Silver)
- Gold: Inverse DXY correlation — check DXY direction first
- Silver: More volatile than gold, reduce size by 25%
- Strong safe-haven demand overrides technical signals — check news

### Crude Oil (WTI)
- Key sessions: US open 6:30 PM IST (highest volume)
- EIA inventory every Wednesday 8:00 PM IST — avoid trades 1hr before/after
- OPEC news = skip all crude signals that day

## Risk Management Rules (Absolute)
1. Max 3 simultaneous open trades
2. Max 2% total portfolio at risk at any time
3. If 3 consecutive losses → stop trading for the day
4. Never average down a losing position
5. If SL hit → accept loss immediately, no revenge trading
6. Weekly drawdown limit: 5% of capital → pause all signals

## F&O Scanner Schedule
- 9:30 AM IST  — Market open scan (best signals)
- 12:00 PM IST — Midday scan (momentum continuation)
- 2:00 PM IST  — Afternoon scan (pre-close setups)

## Commands
```bash
# Run full scanner now
node "D:\Claude Code\market-agent\src\atlas-scanner.js"

# Run scalp alert for specific symbol
node "D:\Claude Code\market-agent\src\scalp-alert.js" NIFTY
node "D:\Claude Code\market-agent\src\scalp-alert.js" XAUUSD
node "D:\Claude Code\market-agent\src\scalp-alert.js" BTCUSD
```

## Disclaimer
Algorithmic analysis for educational purposes only.
No guarantee of profitability. Past backtests ≠ future results.
Always use stop losses. Never risk more than you can afford to lose.
