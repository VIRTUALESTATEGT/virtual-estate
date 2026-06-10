const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const supabase = require('../config/supabase');

const IG_BASE        = 'https://graph.facebook.com/v19.0';
const VERIFY_TOKEN   = process.env.INSTAGRAM_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || 'virtual-estate-webhook';
const ACCESS_TOKEN   = process.env.INSTAGRAM_ACCESS_TOKEN || '';
const ADMIN_PSID     = process.env.INSTAGRAM_ADMIN_PSID   || '';

// ── Send a text reply to an Instagram DM sender (by PSID) ────────────────────
async function sendInstagramMessage(recipientId, text) {
  if (!ACCESS_TOKEN) {
    console.warn('[IG] INSTAGRAM_ACCESS_TOKEN not set — skipping send');
    return null;
  }
  try {
    const { data } = await axios.post(
      `${IG_BASE}/me/messages`,
      { recipient: { id: recipientId }, message: { text } },
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
    );
    console.log('[IG] sendMessage OK → recipientId:', recipientId, '| msg_id:', data?.message_id);
    return data;
  } catch (e) {
    const metaErr = e.response?.data?.error;
    console.error('[IG] sendMessage error — HTTP:', e.response?.status, '| body:', JSON.stringify(e.response?.data || e.message));
    throw new Error(metaErr ? `Meta API error ${metaErr.code}: ${metaErr.message}` : e.message);
  }
}

// ── Webhook verification (GET) ────────────────────────────────────────────────
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  console.log('[IG] verify — mode:', mode, '| token match:', token === VERIFY_TOKEN);
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[IG] Webhook verified ✅');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ── Incoming messages (POST) ──────────────────────────────────────────────────
router.post('/', async (req, res) => {
  // Process BEFORE responding — Vercel may cut execution after res.send().
  // Hard 4s ceiling so we always respond within Meta's 5s timeout.
  try {
    const entry = req.body?.entry?.[0];
    const messaging = entry?.messaging?.[0];

    if (messaging && !messaging.message?.is_echo) {
      const senderId = messaging.sender?.id;
      const text     = messaging.message?.text?.trim() || '';

      if (senderId && text) {
        console.log(`[IG] Message from PSID ${senderId}: ${text.slice(0, 80)}`);
        const handler = ADMIN_PSID && senderId === ADMIN_PSID
          ? processAdminCommand(senderId, text)
          : processClientMessage(senderId, text);

        await Promise.race([
          handler,
          new Promise(r => setTimeout(r, 4000)), // yield after 4s max
        ]);
      }
    }
  } catch (e) {
    console.error('[IG] Processing error:', e.message);
  }

  res.sendStatus(200); // ACK after processing (or after 4s ceiling)
});

// ── Admin command processor ───────────────────────────────────────────────────
async function processAdminCommand(psid, text) {
  const upper = text.toUpperCase().trim();

  if (upper === 'RESUMEN') {
    const { data: activas } = await supabase
      .from('conversaciones_instagram').select('id', { count: 'exact' }).eq('estado', 'activa');
    await sendInstagramMessage(psid,
      `📊 RESUMEN VIRTUAL ESTATE\n• Conversaciones activas: ${activas?.length ?? 0}`
    );
    return;
  }

  const responderMatch = text.match(/^RESPONDER\s+(\d+):\s*(.+)/is);
  if (responderMatch) {
    const [, convId, respuesta] = responderMatch;
    const { data: conv } = await supabase
      .from('conversaciones_instagram').select('*').eq('id', convId).maybeSingle();
    if (!conv) { await sendInstagramMessage(psid, `❌ Conversación #${convId} no encontrada`); return; }
    await supabase.from('mensajes').insert([{
      conversacion_id: Number(convId), remitente_tipo: 'agente_humano', contenido: respuesta.trim()
    }]);
    await supabase.from('conversaciones_instagram')
      .update({ ultima_respuesta_tipo: 'agente_humano', timestamp: new Date().toISOString() })
      .eq('id', convId);
    if (conv.creada_por_cliente) await sendInstagramMessage(conv.creada_por_cliente, respuesta.trim());
    await sendInstagramMessage(psid, `✅ Respuesta enviada a conversación #${convId}`);
    return;
  }

  await sendInstagramMessage(psid, `❓ Comandos disponibles:\nRESUMEN | RESPONDER [ID]: [texto]`);
}

// ── Client message processor ──────────────────────────────────────────────────
async function processClientMessage(psid, text) {
  console.log('[IG] processClientMessage ▶ psid:', psid, '| text:', text.slice(0, 60));

  // Direct INSERT
  let convId = null;
  try {
    const { data, error } = await supabase
      .from('conversaciones_instagram')
      .insert([{ psid, canal: 'instagram', estado: 'activa' }])
      .select('id');
    if (error) {
      console.error('[IG] conv insert error:', error.message, '| code:', error.code);
    } else {
      convId = data?.[0]?.id ?? null;
      console.log('[IG] conv created — id:', convId);
    }
  } catch (e) {
    console.error('[IG] conv insert threw:', e.message);
  }

  // Save client message (best-effort)
  if (convId) {
    try {
      await supabase.from('mensajes')
        .insert([{ conversacion_id: convId, remitente_tipo: 'cliente', contenido: text }]);
    } catch (e) {
      console.error('[IG] mensajes insert error:', e.message);
    }
  }

  // Call AI agent
  console.log('[IG] llamando responderIA — conv_id:', convId);
  try {
    const { responderIA } = require('./agente-ia');
    const respuesta = await responderIA(convId, text);
    console.log('[IG] responderIA result — length:', respuesta?.length ?? 'null');
    if (respuesta) {
      console.log('[IG] enviando respuesta → psid:', psid);
      await sendInstagramMessage(psid, respuesta);
    } else {
      console.warn('[IG] responderIA devolvió vacío');
    }
  } catch (e) {
    console.error('[IG] IA error:', e.message);
    await sendInstagramMessage(psid, 'Hola 👋 Recibimos tu mensaje. Un asesor te contactará pronto.')
      .catch(se => console.error('[IG] fallback send error:', se.message));
  }
}

module.exports = router;
