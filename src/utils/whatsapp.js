const axios = require('axios');

const PHONE_ID    = process.env.WHATSAPP_BUSINESS_PHONE_ID;
const TOKEN       = process.env.WHATSAPP_ACCESS_TOKEN;
const ADMIN_NUM   = process.env.WHATSAPP_ADMIN_NUMBER; // e.g. "50239902399"
const WA_BASE     = 'https://graph.facebook.com/v19.0';

async function sendWhatsAppMessage(to, text) {
  if (!PHONE_ID || !TOKEN) {
    console.warn('[WhatsApp] Credentials not configured — skipping send');
    return null;
  }
  const phone = String(to).replace(/\D/g, '');
  try {
    const { data } = await axios.post(
      `${WA_BASE}/${PHONE_ID}/messages`,
      { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text } },
      { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }
    );
    return data;
  } catch (e) {
    console.error('[WhatsApp] Send error:', e.response?.data || e.message);
    return null;
  }
}

async function notifyAdmin(text) {
  if (!ADMIN_NUM) return null;
  return sendWhatsAppMessage(ADMIN_NUM, text);
}

function isAdminNumber(from) {
  if (!ADMIN_NUM) return false;
  return String(from).replace(/\D/g, '') === String(ADMIN_NUM).replace(/\D/g, '');
}

module.exports = { sendWhatsAppMessage, notifyAdmin, isAdminNumber, ADMIN_NUM };
