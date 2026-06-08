# Market Alert Agent — ATLAS Trader AI

## Trader Persona
Read TRADER-SKILL.md for the full expert trader persona and framework.
When user asks for any scalping trade, chart, or market analysis — act as ATLAS (the 25yr expert trader).

## Quick Command: Scalping Trade with WhatsApp Chart
```bash
node "D:\Claude Code\market-agent\src\scalp-alert.js" XAUUSD
node "D:\Claude Code\market-agent\src\scalp-alert.js" NIFTY
node "D:\Claude Code\market-agent\src\scalp-alert.js" BTCUSD
node "D:\Claude Code\market-agent\src\scalp-alert.js" BANKNIFTY
node "D:\Claude Code\market-agent\src\scalp-alert.js" CRUDE
node "D:\Claude Code\market-agent\src\scalp-alert.js" SILVER
```
This fetches live data, generates a dark-theme chart, and sends BOTH the chart image and full analysis to WhatsApp automatically.

---

# Market Alert Agent

This project monitors stock/index prices and sends WhatsApp alerts.

## How to manage alerts (ask Claude naturally)

When the user says things like:
- "Alert me if Nifty crosses above 23500"
- "Add an alert for HDFC Bank below 1800"
- "Remove the RIL alert"
- "What alerts are active?"
- "Clear all triggered alerts"

Use the manage-alerts.js CLI to do it:

```bash
# Add alert
node src/manage-alerts.js add --symbol NSE:NIFTY --name "Nifty 50" --condition above --price 23500
node src/manage-alerts.js add --symbol NSE:HDFCBANK --name "HDFC Bank" --condition below --price 1800

# Remove alert
node src/manage-alerts.js remove --id nifty-above-23500

# List alerts
node src/manage-alerts.js list

# Re-arm triggered alerts
node src/manage-alerts.js clear-triggered
```

## Common symbol mappings

| Asset         | TradingView Symbol      |
|---------------|-------------------------|
| Nifty 50      | NSE:NIFTY               |
| Bank Nifty    | NSE:BANKNIFTY           |
| GIFT Nifty    | NSE:GIFT_NIFTY          |
| Sensex        | BSE:SENSEX              |
| RIL/Reliance  | NSE:RELIANCE            |
| HDFC Bank     | NSE:HDFCBANK            |
| TCS           | NSE:TCS                 |
| Infosys       | NSE:INFY                |
| ICICI Bank    | NSE:ICICIBANK           |
| SBI           | NSE:SBIN                |
| USDINR        | FX_IDC:USDINR           |
| Crude Oil     | TVC:USOIL               |
| Gold          | TVC:GOLD                |
| Silver        | TVC:SILVER              |
| Bitcoin       | BITSTAMP:BTCUSD         |

## Config files
- `config/alerts.json`   -- alert conditions (auto-managed)
- `config/settings.json` -- WhatsApp phone + API key

## WhatsApp setup
1. Save +34 644 59 71 19 as a contact named "CallMeBot"
2. Send: `I allow callmebot to send me messages`
3. Copy the API key from the reply
4. Add it to config/settings.json -> whatsapp.apikey

## Test WhatsApp
```bash
node src/test-whatsapp.js
```

## Scheduled tasks (Windows Task Scheduler)
- MarketAgent_MorningBriefing -- 7:30 AM daily
- MarketAgent_PriceMonitor    -- every 3 min, Mon-Fri 9:00-15:35 IST
- MarketAgent_DailyReset      -- 9:00 AM Mon-Fri (re-arms alerts)
