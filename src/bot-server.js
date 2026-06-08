#!/usr/bin/env node
// ╔══════════════════════════════════════════════════════════════════╗
// ║  ATLAS PRO — WhatsApp Bot Server                                 ║
// ║  Receives incoming WhatsApp messages via Green API webhook       ║
// ║  Parses intent → runs the right script → replies on WhatsApp    ║
// ║  Deploy to Railway (free tier, no sleep, auto-deploys from Git)  ║
// ╚══════════════════════════════════════════════════════════════════╝
//
// Supported commands (natural language):
//   "scalp NIFTY"                     → Scalp trade analysis + chart
//   "Give me scalping idea for RIL"   → Same
//   "scan" / "F&O signals"            → ATLAS PRO full scanner
//   "morning briefing"                → Market overview
//   "alert me if nifty above 23500"   → Add price alert
//   "list alerts"                     → Show active alerts
//   "remove nifty alert"              → Delete alert
//   "help"                            → Command list

const http = require('http');
const { parseCommand } = require('./command-parser');
const { listAlerts, addAlert, removeAlert } = require('./alerts-api');
const log = require('./logger');

const PORT         = process.env.PORT || 3000;
const OWNER_PHONE  = process.env.OWNER_PHONE || (require('../config/settings.json').whatsapp.phone || '919727686181');
const OWNER_CHATID = OWNER_PHONE.replace(/^\+/, '') + '@c.us';

// ── Rate-limit: max 1 command per 10s per chat ────────────────────────────────
const lastProcessed = {};
function isRateLimited(chatId) {
  const now = Date.now();
  if (lastProcessed[chatId] && now - lastProcessed[chatId] < 10000) return true;
  lastProcessed[chatId] = now;
  return false;
}

// ── Dedup: ignore duplicate webhook deliveries ────────────────────────────────
const seenMessages = new Set();

// ── Process a command (async, non-blocking) ───────────────────────────────────
async function processCommand(text, chatId) {
  const cmd = parseCommand(text);
  log.info(`[Bot] Command: ${JSON.stringify(cmd)} from ${chatId}`);

  const { sendWhatsApp } = require('./whatsapp');

  switch (cmd.type) {

    case 'HELP':
      await sendWhatsApp(
        `🤖 *ATLAS PRO Bot — Commands*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📊 *Trade Setups*\n` +
        `• "scalp NIFTY" — trade idea for Nifty\n` +
        `• "scalp RIL" — trade idea for Reliance\n` +
        `• "trade idea BTCUSD" — Bitcoin setup\n` +
        `• "gold signal" — Gold trade setup\n\n` +
        `📡 *Market Scan*\n` +
        `• "scan" — full F&O + multi-asset scan\n` +
        `• "signals" — same as scan\n\n` +
        `🌅 *Briefing*\n` +
        `• "morning briefing" — market overview\n` +
        `• "market update" — same\n\n` +
        `🔔 *Price Alerts*\n` +
        `• "alert nifty above 23500"\n` +
        `• "alert RIL below 1250"\n` +
        `• "list alerts" — see active alerts\n` +
        `• "remove nifty alert" — delete alert\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `_Powered by ATLAS PRO · Claude AI_`
      );
      break;

    case 'SCALP': {
      await sendWhatsApp(`⏳ Fetching live data for *${cmd.symbol}*...\n_Analysis takes ~10 seconds_`);
      // Run async — don't block webhook response
      const { run } = require('./scalp-alert');
      const result = await run(cmd.symbol).catch(async (err) => {
        log.error('[Bot] Scalp error: ' + err.message);
        await sendWhatsApp(`❌ Error analysing ${cmd.symbol}: ${err.message}`);
      });
      if (result?.error) await sendWhatsApp(`❌ ${result.error}`);
      break;
    }

    case 'SCAN': {
      await sendWhatsApp(`⏳ *ATLAS PRO Scanner* running...\nScanning 100 F&O stocks + Crypto/Forex/Metals\n_Takes ~30 seconds_`);
      const { run } = require('./atlas-scanner');
      const result = await run().catch(async (err) => {
        log.error('[Bot] Scanner error: ' + err.message);
        await sendWhatsApp(`❌ Scanner error: ${err.message}`);
      });
      if (result?.signals === 0) {
        await sendWhatsApp(
          `📋 *ATLAS PRO Scan Complete*\n\nNo high-conviction setups (4+/5) right now.\nMarket may be choppy or consolidating.\n\n_Try again at 9:30 AM, 12:00 PM or 2:00 PM IST_`
        );
      }
      break;
    }

    case 'BRIEFING': {
      await sendWhatsApp(`⏳ Fetching market data for briefing...`);
      const { run } = require('./morning-briefing');
      await run().catch(async (err) => {
        log.error('[Bot] Briefing error: ' + err.message);
        await sendWhatsApp(`❌ Briefing error: ${err.message}`);
      });
      break;
    }

    case 'LIST_ALERTS': {
      const msg = listAlerts();
      await sendWhatsApp(msg);
      break;
    }

    case 'ADD_ALERT': {
      // Map symbol to TradingView format
      const tvMap = {
        'NIFTY': 'NSE:NIFTY', 'BANKNIFTY': 'NSE:BANKNIFTY', 'SENSEX': 'BSE:SENSEX',
        'RELIANCE': 'NSE:RELIANCE', 'HDFCBANK': 'NSE:HDFCBANK', 'TCS': 'NSE:TCS',
        'INFY': 'NSE:INFY', 'ICICIBANK': 'NSE:ICICIBANK', 'SBIN': 'NSE:SBIN',
        'XAUUSD': 'TVC:GOLD', 'BTCUSD': 'BITSTAMP:BTCUSD', 'CRUDE': 'TVC:USOIL',
        'SILVER': 'TVC:SILVER', 'USDINR': 'FX_IDC:USDINR', 'ETHUSD': 'BITSTAMP:ETHUSD',
      };
      const tvSymbol = tvMap[cmd.symbol] || `NSE:${cmd.symbol}`;
      const msg = addAlert(tvSymbol, cmd.symbol, cmd.condition, cmd.price);
      await sendWhatsApp(msg);
      break;
    }

    case 'UNKNOWN':
    default: {
      await sendWhatsApp(
        `🤔 I didn't understand that.\n\n` +
        `Try:\n` +
        `• "scalp NIFTY" — trade analysis\n` +
        `• "scan" — market scan\n` +
        `• "alert nifty above 23500"\n` +
        `• "help" — full command list`
      );
      break;
    }
  }
}

// ── Parse raw HTTP body ───────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ── HTTP Server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {

  // Health check (Railway/Render ping)
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'ATLAS PRO WhatsApp Bot',
      uptime: Math.floor(process.uptime()) + 's',
      ts: new Date().toISOString()
    }));
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405); res.end(); return;
  }

  // Respond to Green API immediately (< 500ms or it retries)
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'received' }));

  // Parse webhook body
  const body = await readBody(req).catch(() => ({}));

  try {
    // Only handle incoming text messages
    if (body.typeWebhook !== 'incomingMessageReceived') return;
    if (body.messageData?.typeMessage !== 'textMessage') return;

    const chatId  = body.senderData?.chatId || '';
    const msgId   = body.idMessage || '';
    const msgText = body.messageData?.textMessageData?.textMessage || '';

    // Security: only process messages from the owner's number
    if (chatId !== OWNER_CHATID) {
      log.info(`[Bot] Ignored message from non-owner: ${chatId}`);
      return;
    }

    // Dedup
    if (seenMessages.has(msgId)) { log.info('[Bot] Duplicate webhook, skipping'); return; }
    seenMessages.add(msgId);
    if (seenMessages.size > 100) {
      // Keep last 100 only
      const iter = seenMessages.values();
      for (let i = 0; i < 50; i++) seenMessages.delete(iter.next().value);
    }

    // Rate limit
    if (isRateLimited(chatId)) {
      log.info('[Bot] Rate limited, skipping');
      return;
    }

    log.info(`[Bot] Message from owner: "${msgText}"`);

    // Process command async (don't await — already replied 200)
    processCommand(msgText, chatId).catch(err => {
      log.error('[Bot] processCommand error: ' + err.message);
    });

  } catch (err) {
    log.error('[Bot] Webhook parse error: ' + err.message);
  }
});

server.listen(PORT, () => {
  log.info(`[Bot] ATLAS PRO WhatsApp Bot running on port ${PORT}`);
  log.info(`[Bot] Owner: ${OWNER_CHATID}`);
  log.info('[Bot] Waiting for WhatsApp messages...');
});

// Graceful shutdown
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT',  () => { server.close(() => process.exit(0)); });
