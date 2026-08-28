const axios = require('axios');
const { maskPhone } = require('./mask');

const WA_BASE = 'https://graph.facebook.com/v19.0';

async function sendWhatsAppMessage(to, text) {
  const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!PHONE_ID || !TOKEN) {
    console.warn('[WhatsApp] Credentials not configured — skipping send');
    return null;
  }

  const phoneRaw = String(to);
  const phone = phoneRaw.replace(/\D/g, '');
  console.log('[WA-MSG] sending — phone:', maskPhone(phoneRaw), '| text length:', text.length);
  try {
    const { data } = await axios.post(
      `${WA_BASE}/${PHONE_ID}/messages`,
      { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text } },
      { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }
    );
    console.log('[WA-MSG] Meta response:', JSON.stringify(data));
    // contacts[0].wa_id is the number Meta resolved — must match intended recipient
    if (data?.contacts?.[0]) console.log('[WA-MSG] resolved wa_id:', data.contacts[0].wa_id, '| msg_id:', data.messages?.[0]?.id);
    return data;
  } catch (e) {
    const metaErr = e.response?.data?.error;
    const msg = metaErr
      ? `Meta API error ${metaErr.code}: ${metaErr.message}`
      : e.message;
    console.error('[WA-MSG] error — phone:', maskPhone(phone), '| HTTP:', e.response?.status, '| body:', JSON.stringify(e.response?.data || e.message));
    throw new Error(msg);
  }
}

async function notifyAdmin(text) {
  const ADMIN_NUM = process.env.WHATSAPP_ADMIN_NUMBER;
  if (!ADMIN_NUM) {
    console.warn('[notifyAdmin] WHATSAPP_ADMIN_NUMBER no configurado — omitiendo notificación');
    return null;
  }
  return sendWhatsAppMessage(ADMIN_NUM, text).catch(e => {
    console.error('[notifyAdmin] WA send failed | phone:', ADMIN_NUM, '| error:', e.message);
    return null;
  });
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

  const phoneRaw = String(to);
  const phone = phoneRaw.replace(/\D/g, '');
  console.log('[WA-DOC] sending — phone:', maskPhone(phoneRaw), '| filename:', filename, '| url:', documentUrl?.slice(0, 80));
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
    console.log('[WA-DOC] Meta response:', JSON.stringify(data));
    if (data?.contacts?.[0]) console.log('[WA-DOC] resolved wa_id:', data.contacts[0].wa_id, '| msg_id:', data.messages?.[0]?.id);
    return data;
  } catch (e) {
    const metaErr = e.response?.data?.error;
    const msg = metaErr
      ? `Meta API error ${metaErr.code}: ${metaErr.message}`
      : e.message;
    console.error('[WA-DOC] error — phone:', maskPhone(phone), '| HTTP:', e.response?.status, '| body:', JSON.stringify(e.response?.data || e.message));
    throw new Error(msg);
  }
}

// Send a pre-approved template message.
// params: array of string values for {{1}}, {{2}}, ... in the template body.
// languageCode must match the language used when the template was submitted to Meta.
async function sendWhatsAppTemplate(to, templateName, params, languageCode = 'es') {
  const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!PHONE_ID || !TOKEN) {
    console.warn('[WhatsApp] Credentials not configured — skipping template send');
    return null;
  }

  const phone = String(to).replace(/\D/g, '');
  const components = params.length ? [{
    type: 'body',
    parameters: params.map(p => ({ type: 'text', text: String(p) })),
  }] : [];

  console.log('[WA-TPL] sending template:', templateName, '| phone:', maskPhone(phone), '| params count:', params.length);
  try {
    const { data } = await axios.post(
      `${WA_BASE}/${PHONE_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: { name: templateName, language: { code: languageCode }, components },
      },
      { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }
    );
    console.log('[WA-TPL] Meta response:', JSON.stringify(data));
    if (data?.contacts?.[0]) console.log('[WA-TPL] resolved wa_id:', data.contacts[0].wa_id, '| msg_id:', data.messages?.[0]?.id);
    return data;
  } catch (e) {
    const metaErr = e.response?.data?.error;
    const msg = metaErr ? `Meta API error ${metaErr.code}: ${metaErr.message}` : e.message;
    console.error('[WA-TPL] error — phone:', maskPhone(phone), '| HTTP:', e.response?.status, '| body:', JSON.stringify(e.response?.data || e.message));
    throw new Error(msg);
  }
}

module.exports = { sendWhatsAppMessage, sendWhatsAppDocument, sendWhatsAppTemplate, notifyAdmin, isAdminNumber };
