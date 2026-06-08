#!/usr/bin/env node
// Quick test — sends a test WhatsApp message to verify setup
const { sendWhatsApp } = require('./whatsapp');

const msg =
  `✅ *Market Agent Test*\n` +
  `━━━━━━━━━━━━━━━━━━━━\n` +
  `Your WhatsApp alert system is working!\n\n` +
  `You will receive:\n` +
  `• 🌅 Morning briefings at 7:30 AM IST\n` +
  `• 🚨 Price alerts when your targets are hit\n\n` +
  `_Market Agent by Claude_`;

sendWhatsApp(msg)
  .then(ok => setTimeout(() => process.exit(ok ? 0 : 1), 100));
