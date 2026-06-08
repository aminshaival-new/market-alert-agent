// NSE Options Helper — reads lot sizes and expiry days from config/settings.json

const settings = require('../config/settings.json');

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// Returns the next expiry date for a given weekday (0=Sun … 6=Sat)
// If today IS that weekday AND it's before market close (15:30 IST) → today is expiry
// Otherwise → find the next occurrence of that weekday
function getNextExpiryDate(targetDow) {
  const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const todayDow  = nowIST.getDay();
  const hour      = nowIST.getHours();
  const minute    = nowIST.getMinutes();
  const marketClosed = hour > 15 || (hour === 15 && minute >= 30);

  let daysAhead;
  if (todayDow === targetDow && !marketClosed) {
    // Today is expiry day and market still open
    daysAhead = 0;
  } else {
    // How many days until the next targetDow
    daysAhead = (targetDow - todayDow + 7) % 7;
    if (daysAhead === 0) daysAhead = 7; // already passed today or market closed
  }

  const expiry = new Date(nowIST);
  expiry.setDate(nowIST.getDate() + daysAhead);
  expiry.setHours(15, 30, 0, 0);
  return expiry;
}

function getOptionsConfig(symbolKey) {
  // symbolKey: NIFTY, BANKNIFTY, SENSEX
  const cfg = (settings.options || {})[symbolKey];
  if (!cfg) return null;
  return {
    lotSize:    cfg.lotSize,
    strikeStep: cfg.strikeStep,
    expiryDay:  cfg.expiryDay,   // 0–6
    expiryType: cfg.expiryType   // weekly / monthly
  };
}

function getATMStrike(price, step) {
  return Math.round(price / step) * step;
}

function formatExpiryLabel(date) {
  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata'
  });
}

function daysUntil(date) {
  const nowIST  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const diffMs  = date - nowIST;
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

function getOptionRecommendation(analysis, symbolKey) {
  const cfg = getOptionsConfig(symbolKey);
  if (!cfg) return null;

  const { direction, levels, confluence, snapshot } = analysis;
  const { close }  = snapshot;
  const { entry, sl, target } = levels;
  const quality    = confluence.quality;

  const expDate    = getNextExpiryDate(cfg.expiryDay);
  const daysLeft   = daysUntil(expDate);
  const expiryLabel = formatExpiryLabel(expDate);
  const expiryDayName = DAY_NAMES[cfg.expiryDay];

  const atm        = getATMStrike(close, cfg.strikeStep);

  // Strike selection: ATM for scalp (<3 DTE), allow 1 step OTM only on high conviction
  let recommendedStrike, otmStrike, optionType, strikeNote;
  if (direction === 'LONG') {
    optionType        = 'CE';
    recommendedStrike = atm;
    otmStrike         = atm + cfg.strikeStep;
    strikeNote = quality === 'A+ SETUP' && daysLeft >= 3
      ? `ATM ${atm} CE (safer) or OTM ${otmStrike} CE (aggressive)`
      : `ATM ${atm} CE — recommended for ${daysLeft}d to expiry`;
  } else {
    optionType        = 'PE';
    recommendedStrike = atm;
    otmStrike         = atm - cfg.strikeStep;
    strikeNote = quality === 'A+ SETUP' && daysLeft >= 3
      ? `ATM ${atm} PE (safer) or OTM ${otmStrike} PE (aggressive)`
      : `ATM ${atm} PE — recommended for ${daysLeft}d to expiry`;
  }

  // Rough P&L estimate using delta ~0.45 for ATM
  const delta          = 0.45;
  const indexMove      = Math.abs(target - entry);
  const indexRisk      = Math.abs(sl - entry);
  const estPremiumGain = Math.round(indexMove * delta);
  const estPremiumLoss = Math.round(indexRisk * delta);
  const lotGain        = estPremiumGain * cfg.lotSize;
  const lotLoss        = estPremiumLoss * cfg.lotSize;

  return {
    optionType,
    atm,
    recommendedStrike,
    otmStrike,
    strikeNote,
    expiry: {
      date:     expDate,
      label:    expiryLabel,
      dayName:  expiryDayName,
      daysLeft
    },
    lotSize: cfg.lotSize,
    estPremiumGain,
    estPremiumLoss,
    lotGain,
    lotLoss
  };
}

module.exports = { getOptionRecommendation, getOptionsConfig, getNextExpiryDate, getATMStrike };
