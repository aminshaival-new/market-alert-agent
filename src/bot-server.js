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
const { parseCommand }                        = require('./command-parser');
const { listAlerts, addAlert, removeAlert }   = require('./alerts-api');
const { sendWhatsApp, sendWhatsAppImage }     = require('./whatsapp');
const { generateLiveChart }                   = require('./chart-generator');
const { run: runScalp }                       = require('./scalp-alert');
const { run: runScanner }                     = require('./atlas-scanner');
const { run: runBriefing }                    = require('./morning-briefing');
const { runCheck: monitorRunCheck }           = require('./monitor');
const log = require('./logger');

const PORT         = process.env.PORT || 3000;
const OWNER_PHONE  = process.env.OWNER_PHONE || (require('../config/settings.json').whatsapp.phone || '919727686181');
const OWNER_CHATID = OWNER_PHONE.replace(/^\+/, '') + '@c.us';

// ── Track bot's own sent messages to avoid processing them as commands ────────
const botSentIds = new Set();
// Clean up botSentIds every 5 minutes — prevents unbounded memory growth
setInterval(() => {
  if (botSentIds.size > 200) {
    const iter = botSentIds.values();
    for (let i = 0; i < 100; i++) botSentIds.delete(iter.next().value);
  }
}, 5 * 60 * 1000);

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

  // sendWhatsApp and sendWhatsAppImage are top-level imports

  switch (cmd.type) {

    case 'HELP':
      await sendWhatsApp(
        `🤖 *ATLAS PRO Bot — Commands*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📊 *Trade Setups*\n` +
        `• "scalp NIFTY" — Nifty trade idea + chart\n` +
        `• "scalp GBP/JPY" — GBP/JPY forex setup\n` +
        `• "scalp BTCUSD" — Bitcoin setup\n` +
        `• "gold signal" — Gold trade setup\n\n` +
        `🕯️ *Live Charts*\n` +
        `• "chart NIFTY" — 15min candle chart\n` +
        `• "chart GBP/JPY 1h" — 1-hour chart\n` +
        `• "chart BTCUSD 4h" — 4-hour chart\n` +
        `• "chart GOLD daily" — Daily chart\n` +
        `_Timeframes: 1m 3m 5m 15m 30m 1h 2h 4h daily weekly_\n\n` +
        `_Symbols: NIFTY BANKNIFTY SENSEX · GBPJPY EURUSD USDJPY + crosses_\n` +
        `_Crypto: BTCUSD ETHUSD · Metals: GOLD SILVER · Energy: CRUDE_\n\n` +
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

    case 'CHART': {
      const tfLabel = { '1':'1min','3':'3min','5':'5min','15':'15min','30':'30min',
        '60':'1H','120':'2H','240':'4H','D':'Daily','W':'Weekly' }[cmd.interval] || cmd.interval+'min';
      await sendWhatsApp(`📊 Fetching live ${tfLabel} chart for *${cmd.symbol}*...`);
      try {
        const chartData = await generateLiveChart(cmd.symbol, cmd.interval);
        await sendWhatsAppImage(chartData, `📊 ${cmd.symbol} · ${tfLabel} · Live TradingView Chart`);
      } catch (err) {
        log.error('[Bot] Chart error: ' + err.message);
        await sendWhatsApp(`❌ Chart failed for ${cmd.symbol}: ${err.message}\n\n_Try: "scalp ${cmd.symbol}" for full analysis with chart_`);
      }
      break;
    }

    case 'SCALP': {
      await sendWhatsApp(`⏳ Fetching live data for *${cmd.symbol}*...\n_Analysis takes ~10 seconds_`);
      const result = await runScalp(cmd.symbol).catch(async (err) => {
        log.error('[Bot] Scalp error: ' + err.message);
        await sendWhatsApp(`❌ Error analysing ${cmd.symbol}: ${err.message}`);
      });
      if (result?.error) await sendWhatsApp(`❌ ${result.error}`);
      break;
    }

    case 'SCAN': {
      await sendWhatsApp(`⏳ *ATLAS PRO Scanner* running...\nScanning 100 F&O stocks + Crypto/Forex/Metals\n_Takes ~30 seconds_`);
      const result = await runScanner().catch(async (err) => {
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
      await runBriefing().catch(async (err) => {
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

// ── TradingView Alert Webhook handler ─────────────────────────────────────────
// Called when a Pine Script alert fires via webhook to /tv-alert
// Expected JSON payload from TradingView alert message (JSON format):
// { "symbol":"XAUUSD", "action":"BUY", "price":2345.5, "sl":2340.0,
//   "tp":2356.0, "reason":"EMA+RSI+VWAP confluence", "strategy":"GOLD_SCALP" }
async function handleTVAlert(body) {
  const { symbol, action, price, sl, tp, reason, strategy, interval } = body;
  if (!symbol || !action) return;

  const ist = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day:'2-digit', month:'short',
    hour:'2-digit', minute:'2-digit'
  });

  const dir     = action.toUpperCase();
  const emoji   = dir === 'BUY' ? '🟢' : '🔴';
  const dirWord = dir === 'BUY' ? 'BUY / LONG' : 'SELL / SHORT';
  const risk    = sl && price ? Math.abs(price - sl).toFixed(2) : '—';
  const reward  = sl && tp && price
    ? (Math.abs(tp - price) / Math.abs(price - sl)).toFixed(1) : '—';
  const stratLabel = strategy || 'Pine Script Alert';
  const tf      = interval || '15m';

  const msg =
    `${emoji} *${dirWord} ALERT — ${symbol}*\n` +
    `_${ist} IST · ${stratLabel} · ${tf}_\n\n` +
    `*Price*  ${price}\n` +
    (sl  ? `*SL*     ${sl}  _(risk: ${risk} pts)_\n` : '') +
    (tp  ? `*Target* ${tp}  _(RR 1:${reward})_\n` : '') +
    (reason ? `\n*Reason:* ${reason}\n` : '') +
    `\n_⚠️ Verify before entry. Not financial advice._`;

  log.info(`[TV Alert] ${symbol} ${dir} @ ${price} — sending WhatsApp`);

  // Send chart first, then text
  try {
    const chartInterval = { '1m':'1','3m':'3','5m':'5','15m':'15','30m':'30',
      '1h':'60','4h':'240','1d':'D' }[tf] || '15';
    const chartData = await generateLiveChart(symbol, chartInterval);
    await sendWhatsAppImage(chartData, `${emoji} ${symbol} ${dir} @ ${price} | SL ${sl} | TP ${tp}`);
    await new Promise(r => setTimeout(r, 1000));
  } catch (e) {
    log.error('[TV Alert] Chart failed: ' + e.message);
  }

  await sendWhatsApp(msg);
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

  // ── TradingView Pine Script alert webhook ──────────────────────────────────
  if (req.url === '/tv-alert') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'received' }));
    const body = await readBody(req).catch(() => ({}));
    handleTVAlert(body).catch(e => log.error('[TV Alert] Error: ' + e.message));
    return;
  }

  // Respond to Green API immediately (< 500ms or it retries)
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'received' }));

  // Parse webhook body
  const body = await readBody(req).catch(() => ({}));

  try {
    // Handle both incoming AND outgoing (self-message) text messages
    const isIncoming = body.typeWebhook === 'incomingMessageReceived';
    const isOutgoing = body.typeWebhook === 'outgoingMessageReceived' || body.typeWebhook === 'outgoingMessageSent';
    if (!isIncoming && !isOutgoing) return;
    if (body.messageData?.typeMessage !== 'textMessage') return;

    const chatId  = isIncoming
      ? (body.senderData?.chatId || '')
      : (body.senderData?.chatId || OWNER_CHATID);
    const msgId   = body.idMessage || '';
    const msgText = body.messageData?.textMessageData?.textMessage || '';

    // Skip messages sent BY the bot itself (to avoid response loops)
    if (isOutgoing && body.senderData?.sender !== OWNER_CHATID.replace('@c.us','')) return;

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

// ── Green API Polling (more reliable than webhooks for self-messages) ─────────
// Polls for new messages every 3 seconds using receiveNotification endpoint
async function pollMessages() {
  const idInstance   = process.env.GREENAPI_ID    || (require('../config/settings.json').whatsapp?.greenapi?.idInstance);
  const apiToken     = process.env.GREENAPI_TOKEN || (require('../config/settings.json').whatsapp?.greenapi?.apiTokenInstance);

  if (!idInstance || idInstance.startsWith('SET_VIA')) {
    log.info('[Poll] Green API not configured, polling disabled');
    return;
  }

  log.info('[Poll] Starting Green API message polling every 3s...');

  async function poll() {
    try {
      const url = `https://api.green-api.com/waInstance${idInstance}/receiveNotification/${apiToken}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return;

      const body = await res.json();
      if (!body || !body.receiptId) return; // No new notifications

      const receiptId = body.receiptId;
      const payload   = body.body;

      // Always delete notification to advance the queue
      await fetch(`https://api.green-api.com/waInstance${idInstance}/deleteNotification/${apiToken}/${receiptId}`, {
        method: 'DELETE'
      }).catch(() => {});

      if (!payload) return;
      const type = payload.typeWebhook;
      log.info(`[Poll] Notification type: ${type}`);

      // Accept incoming messages from owner OR outgoing messages typed by owner
      const isIncoming = type === 'incomingMessageReceived';
      const isOutgoing = type === 'outgoingMessageReceived' || type === 'outgoingMessageSent';
      if (!isIncoming && !isOutgoing) return;
      if (payload.messageData?.typeMessage !== 'textMessage') return;

      const msgId   = payload.idMessage || '';
      const msgText = payload.messageData?.textMessageData?.textMessage || '';

      // For outgoing: only process messages sent BY the owner (not bot responses)
      // Bot-sent messages are tracked in botSentIds set
      if (isOutgoing && botSentIds.has(msgId)) {
        log.info(`[Poll] Skipping bot's own outgoing message`);
        return;
      }

      // For incoming: verify it came from owner's number
      const chatId = payload.senderData?.chatId || '';
      if (isIncoming && chatId !== OWNER_CHATID) {
        log.info(`[Poll] Ignored from non-owner: ${chatId}`);
        return;
      }

      // Dedup
      if (seenMessages.has(msgId)) return;
      seenMessages.add(msgId);
      if (seenMessages.size > 200) {
        const iter = seenMessages.values();
        for (let i = 0; i < 100; i++) seenMessages.delete(iter.next().value);
      }

      // Rate limit
      if (isRateLimited(chatId)) return;

      log.info(`[Poll] Command received: "${msgText}"`);
      processCommand(msgText, chatId).catch(err => log.error('[Poll] Error: ' + err.message));

    } catch (err) {
      if (err.name !== 'TimeoutError') log.error('[Poll] Error: ' + err.message);
    }
  }

  // Poll with recursive setTimeout — ensures no concurrent overlapping polls
  // (setInterval with async can start a new poll before the previous finishes)
  async function schedulePoll() {
    await poll();
    setTimeout(schedulePoll, 3000);
  }
  schedulePoll();
}

// ── Built-in Scheduler (replaces GitHub Actions cron — Railway runs 24/7) ────
// Checks every minute if a scheduled task should run (IST time)
function startScheduler() {
  const lastRun = {};

  function getIST() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  }

  function isWeekday(d) {
    const day = d.getDay(); return day >= 1 && day <= 5; // Mon-Fri
  }

  function shouldRun(key, h, m) {
    const now  = getIST();
    const match = now.getHours() === h && now.getMinutes() === m;
    if (!match) return false;
    // Only fire once per minute window
    const windowKey = `${key}-${now.toDateString()}-${h}:${m}`;
    if (lastRun[windowKey]) return false;
    lastRun[windowKey] = true;
    return true;
  }

  async function tick() {
    const now = getIST();

    // ── Morning Briefing: 7:30 AM IST daily ───────────────────────────────────
    if (shouldRun('briefing', 7, 30)) {
      log.info('[Scheduler] Running morning briefing...');
      runBriefing().catch(e => log.error('[Scheduler] Briefing error: ' + e.message));
    }

    // ── Price Alert Monitor: every 5 min, Mon-Fri 9:15 AM – 3:30 PM IST ──────
    const h = now.getHours(), mn = now.getMinutes();
    const inMarketHours = isWeekday(now) &&
      ((h === 9 && mn >= 15) || (h >= 10 && h <= 14) || (h === 15 && mn <= 30));
    if (inMarketHours && mn % 5 === 0) {
      const monKey = `monitor-${now.toDateString()}-${h}:${mn}`;
      if (!lastRun[monKey]) {
        lastRun[monKey] = true;
        log.info('[Scheduler] Running price alert monitor...');
        monitorRunCheck().catch(e => log.error('[Scheduler] Monitor error: ' + e.message));
      }
    }

    // ── ATLAS PRO Scanner: 9:30 AM, 12:00 PM, 2:00 PM IST (Mon-Fri) ─────────
    if (isWeekday(now)) {
      const scanTimes = [[9,30], [12,0], [14,0]];
      for (const [sh, sm] of scanTimes) {
        if (shouldRun(`atlas-${sh}:${sm}`, sh, sm)) {
          log.info(`[Scheduler] Running ATLAS PRO scanner (${sh}:${String(sm).padStart(2,'0')} IST)...`);
          runScanner().then(r => {
            if (r?.signals === 0) log.info('[Scheduler] Scanner: no signals this run');
          }).catch(e => log.error('[Scheduler] Scanner error: ' + e.message));
        }
      }
    }

    // Clean up old lastRun keys (prevent memory leak)
    const keys = Object.keys(lastRun);
    if (keys.length > 500) keys.slice(0, 200).forEach(k => delete lastRun[k]);
  }

  // Run tick every 30 seconds (catches the :00 and :30 of every minute)
  // Use recursive setTimeout so tick never overlaps itself
  async function scheduleTick() {
    await tick().catch(e => log.error('[Scheduler] tick error: ' + e.message));
    setTimeout(scheduleTick, 30000);
  }
  scheduleTick();
  log.info('[Scheduler] Built-in scheduler started (Morning 7:30AM | Scanner 9:30AM,12PM,2PM | Monitor every 5min market hours)');
}

// Start polling after server starts
server.listen(PORT, () => {
  log.info(`[Bot] ATLAS PRO WhatsApp Bot running on port ${PORT}`);
  log.info(`[Bot] Owner: ${OWNER_CHATID}`);
  pollMessages();
  startScheduler();
});

// Graceful shutdown
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT',  () => { server.close(() => process.exit(0)); });
