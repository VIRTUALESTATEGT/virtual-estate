const axios = require('axios');

const WA_BASE = 'https://graph.facebook.com/v19.0';

async function sendWhatsAppMessage(to, text) {
  const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN;

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
    const metaErr = e.response?.data?.error;
    const msg = metaErr
      ? `Meta API error ${metaErr.code}: ${metaErr.message}`
      : e.message;
    console.error('[WhatsApp] sendMessage error — phone:', phone, '| status:', e.response?.status, '| detail:', JSON.stringify(e.response?.data || e.message));
    throw new Error(msg);
  }
}

async function notifyAdmin(text) {
  const ADMIN_NUM = process.env.WHATSAPP_ADMIN_NUMBER;
  if (!ADMIN_NUM) return null;
  return sendWhatsAppMessage(ADMIN_NUM, text).catch(() => null);
}

function isAdminNumber(from) {
  const ADMIN_NUM = process.env.WHATSAPP_ADMIN_NUMBER;
  if (!ADMIN_NUM) return false;
  return String(from).replace(/\D/g, '') === String(ADMIN_NUM).replace(/\D/g, '');
}

async function sendWhatsAppDocument(to, documentUrl, filename) {
  const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!PHONE_ID || !TOKEN) {
    console.warn('[WhatsApp] Credentials not configured — skipping document send');
    return null;
  }

  const phone = String(to).replace(/\D/g, '');
  try {
    const { data } = await axios.post(
      `${WA_BASE}/${PHONE_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'document',
        document: { link: documentUrl, filename },
      },
      { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }
    );
    return data;
  } catch (e) {
    const metaErr = e.response?.data?.error;
    const msg = metaErr
      ? `Meta API error ${metaErr.code}: ${metaErr.message}`
      : e.message;
    console.error('[WhatsApp] sendDocument error — phone:', phone, '| status:', e.response?.status, '| detail:', JSON.stringify(e.response?.data || e.message));
    throw new Error(msg);
  }
}

module.exports = { sendWhatsAppMessage, sendWhatsAppDocument, notifyAdmin, isAdminNumber };
