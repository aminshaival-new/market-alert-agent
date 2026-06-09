// Economic Calendar — fetches today's high-impact events from Forex Factory
// Free XML feed, no API key needed
// Converts all times to IST (Asia/Kolkata, UTC+5:30)

const log = require('./logger');

// High-impact currencies we care about
const WATCHED_CURRENCIES = ['USD', 'INR', 'EUR', 'GBP', 'JPY', 'CNY', 'XAU'];

// Country flag emojis
const FLAGS = {
  USD: '🇺🇸', INR: '🇮🇳', EUR: '🇪🇺', GBP: '🇬🇧',
  JPY: '🇯🇵', CNY: '🇨🇳', XAU: '🥇', AUD: '🇦🇺',
  CAD: '🇨🇦', CHF: '🇨🇭', NZD: '🇳🇿'
};

// ── Parse Forex Factory XML (no npm needed) ───────────────────────────────────
function parseEvents(xml) {
  const events = [];
  const eventBlocks = xml.match(/<event>([\s\S]*?)<\/event>/g) || [];

  for (const block of eventBlocks) {
    const get = tag => {
      const m = block.match(new RegExp(`<${tag}>(.*?)<\/${tag}>`));
      return m ? m[1].trim() : '';
    };

    events.push({
      title:    get('title'),
      country:  get('country'),
      date:     get('date'),
      time:     get('time'),
      impact:   get('impact'),
      forecast: get('forecast'),
      previous: get('previous'),
      actual:   get('actual')
    });
  }
  return events;
}

// ── Convert Forex Factory time (US Eastern) to IST ───────────────────────────
function toIST(dateStr, timeStr) {
  try {
    if (!timeStr || timeStr === 'All Day' || timeStr === 'Tentative') {
      return 'All Day';
    }

    // Parse "Jun 09 2026" + "8:30am"
    const dt = new Date(`${dateStr} ${timeStr} EST`);
    if (isNaN(dt)) return timeStr;

    return dt.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return timeStr;
  }
}

// ── Check if event date matches today IST ─────────────────────────────────────
function isToday(dateStr) {
  try {
    const eventDate = new Date(dateStr);
    const today     = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    return eventDate.toDateString() === today.toDateString();
  } catch {
    return false;
  }
}

// ── Fetch and filter today's events ──────────────────────────────────────────
async function getTodayEvents() {
  try {
    const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.xml', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketBot/1.0)' },
      signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) throw new Error(`Calendar fetch failed: ${res.status}`);

    const xml    = await res.text();
    const events = parseEvents(xml);

    // Filter: today + high impact + watched currencies
    const todayHigh = events.filter(e =>
      isToday(e.date) &&
      e.impact === 'High' &&
      WATCHED_CURRENCIES.includes(e.country)
    );

    // Also include medium impact for INR (Indian events)
    const todayMedINR = events.filter(e =>
      isToday(e.date) &&
      e.impact === 'Medium' &&
      e.country === 'INR'
    );

    const combined = [...todayHigh, ...todayMedINR];

    // Remove duplicates and sort by time
    const seen = new Set();
    const unique = combined.filter(e => {
      const key = `${e.title}-${e.country}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });

    return unique;

  } catch (e) {
    log.error('[Calendar] Failed to fetch: ' + e.message);
    return [];
  }
}

// ── Format events for WhatsApp ────────────────────────────────────────────────
function formatEvents(events) {
  if (!events.length) return null;

  const lines = events.map(e => {
    const flag     = FLAGS[e.country] || '🌐';
    const istTime  = toIST(e.date, e.time);
    const forecast = e.forecast ? `  Forecast: ${e.forecast}` : '';
    const previous = e.previous ? `  Prev: ${e.previous}` : '';
    const actual   = e.actual   ? `  ✅ Actual: *${e.actual}*` : '';
    return `${flag} *${e.title}* — ${istTime} IST${forecast}${previous}${actual}`;
  });

  return lines.join('\n');
}

module.exports = { getTodayEvents, formatEvents };
