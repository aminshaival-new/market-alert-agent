// WhatsApp sender via Green API (free tier: 1500 msg/month)
// Credentials: env vars (GitHub Actions) take priority over settings.json (local)

const settings = require('../config/settings.json');

function getCreds() {
  return {
    phone:    settings.whatsapp.phone,
    id:       process.env.GREENAPI_ID    || settings.whatsapp.greenapi.idInstance,
    token:    process.env.GREENAPI_TOKEN || settings.whatsapp.greenapi.apiTokenInstance
  };
}

async function sendWhatsApp(message) {
  const { phone, id: idInstance, token: apiTokenInstance } = getCreds();

  if (!idInstance || idInstance.startsWith('SET_VIA') || idInstance === 'GREENAPI_ID_HERE') {
    console.error('[WhatsApp] Green API not configured. Open config/settings.json and add your idInstance + apiTokenInstance.');
    console.log('[WhatsApp] Message that would have been sent:\n', message);
    return false;
  }

  // Green API: chatId format is countrycode+number@c.us (no + sign)
  const chatId = phone.replace(/^\+/, '') + '@c.us';
  const url = `https://api.green-api.com/waInstance${idInstance}/sendMessage/${apiTokenInstance}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message })
    });

    const body = await res.json();

    if (res.ok && body.idMessage) {
      console.log('[WhatsApp] Sent OK, messageId:', body.idMessage);
      return true;
    } else {
      console.error('[WhatsApp] Failed:', JSON.stringify(body));
      return false;
    }
  } catch (err) {
    console.error('[WhatsApp] Network error:', err.message);
    return false;
  }
}

async function sendWhatsAppImage(imageUrl, caption) {
  const { phone, id: idInstance, token: apiTokenInstance } = getCreds();
  const chatId = phone.replace(/^\+/, '') + '@c.us';

  try {
    let b64;
    if (imageUrl.startsWith('data:image/')) {
      // ChartImg returns base64 data URI directly — no download needed
      b64 = imageUrl.split(',')[1];
    } else {
      // Download image → base64 (QuickChart URL etc.)
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error(`Image fetch failed: ${imgRes.status}`);
      const buf = await imgRes.arrayBuffer();
      b64 = Buffer.from(buf).toString('base64');
    }

    const url = `https://api.green-api.com/waInstance${idInstance}/sendFileByBase64/${apiTokenInstance}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, file: b64, fileName: 'trade-setup.png', caption })
    });
    const body = await res.json();
    if (res.ok && body.idMessage) {
      console.log('[WhatsApp] Image sent OK, messageId:', body.idMessage);
      return true;
    }
    console.error('[WhatsApp] Image send failed:', JSON.stringify(body));
    return false;
  } catch (err) {
    console.error('[WhatsApp] Image send error:', err.message);
    return false;
  }
}

module.exports = { sendWhatsApp, sendWhatsAppImage };
