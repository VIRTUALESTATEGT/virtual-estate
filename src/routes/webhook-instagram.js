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
  res.sendStatus(200); // ACK immediately — Meta requires fast response

  try {
    const entry = req.body?.entry?.[0];
    // Instagram DMs arrive under entry.messaging[]
    const messaging = entry?.messaging?.[0];
    if (!messaging) return;

    const senderId = messaging.sender?.id;
    const text     = messaging.message?.text?.trim() || '';

    // Ignore echo messages (sent by the page itself)
    if (messaging.message?.is_echo) return;
    if (!senderId || !text) return;

    console.log(`[IG] Message from PSID ${senderId}: ${text.slice(0, 80)}`);

    if (ADMIN_PSID && senderId === ADMIN_PSID) {
      await processAdminCommand(senderId, text);
    } else {
      await processClientMessage(senderId, text);
    }
  } catch (e) {
    console.error('[IG] Processing error:', e.message);
  }
});

// ── Admin command processor ───────────────────────────────────────────────────
async function processAdminCommand(psid, text) {
  const upper = text.toUpperCase().trim();

  if (upper === 'RESUMEN') {
    const { data: activas } = await supabase
      .from('conversaciones_multicanal').select('id', { count: 'exact' }).eq('estado', 'activa');
    await sendInstagramMessage(psid,
      `📊 RESUMEN VIRTUAL ESTATE\n` +
      `• Conversaciones activas: ${activas?.length ?? 0}`
    );
    return;
  }

  // RESPONDER [ID]: [texto]
  const responderMatch = text.match(/^RESPONDER\s+(\d+):\s*(.+)/is);
  if (responderMatch) {
    const [, convId, respuesta] = responderMatch;
    const { data: conv } = await supabase
      .from('conversaciones_multicanal').select('*').eq('id', convId).maybeSingle();
    if (!conv) { await sendInstagramMessage(psid, `❌ Conversación #${convId} no encontrada`); return; }
    await supabase.from('mensajes').insert([{
      conversacion_id: Number(convId), remitente_tipo: 'agente_humano', contenido: respuesta.trim()
    }]);
    await supabase.from('conversaciones_multicanal')
      .update({ ultima_respuesta_tipo: 'agente_humano', timestamp: new Date().toISOString() })
      .eq('id', convId);
    if (conv.creada_por_cliente) await sendInstagramMessage(conv.creada_por_cliente, respuesta.trim());
    await sendInstagramMessage(psid, `✅ Respuesta enviada a conversación #${convId}`);
    return;
  }

  await sendInstagramMessage(psid,
    `❓ Comandos disponibles:\nRESUMEN | RESPONDER [ID]: [texto]`
  );
}

// ── Client message processor ──────────────────────────────────────────────────
async function processClientMessage(psid, text) {
  console.log('[IG] processClientMessage ▶ psid:', psid, '| text:', text.slice(0, 60));
  console.log('[IG-DEBUG] supabase client:', typeof supabase, supabase ? 'exists' : 'NULL');
  console.log('[IG-DEBUG] SUPABASE_URL:', process.env.SUPABASE_URL ? 'set' : 'UNDEFINED');
  console.log('[IG-DEBUG] SUPABASE_SECRET_KEY:', process.env.SUPABASE_SECRET_KEY ? 'set' : 'UNDEFINED');
  console.log('[IG] paso 1 — antes de conv lookup');

  console.log('[IG] paso 2 — ejecutando query conversaciones_multicanal...');
  let conv, convErr;
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Supabase timeout 5s')), 5000));
    ({ data: conv, error: convErr } = await Promise.race([
      supabase.from('conversaciones_multicanal')
        .select('*').eq('creada_por_cliente', psid).eq('estado', 'activa').maybeSingle(),
      timeout,
    ]));
    console.log('[IG] paso 2 — OK | found:', !!conv, '| error:', convErr?.message || 'none');
  } catch (err) {
    console.error('[IG] paso 2 — error/timeout:', err.message);
    return;
  }

  if (!conv) {
    const payload = { canal: 'instagram', estado: 'activa', creada_por_cliente: psid };
    console.log('[IG] iniciando conversación — datos:', JSON.stringify(payload));
    console.log('[IG] insertando en BD...');
    const { data: newConv, error: insertErr } = await supabase
      .from('conversaciones_multicanal')
      .insert([payload])
      .select().single();
    console.log('[IG] BD insert result — newConv:', JSON.stringify(newConv), '| insertErr:', JSON.stringify(insertErr));
    conv = newConv;
  }

  if (!conv) {
    console.error('[IG] ✗ No se pudo crear/encontrar conversación — abortando');
    return;
  }

  // Save client message
  const { error: msgErr } = await supabase.from('mensajes').insert([{
    conversacion_id: conv.id, remitente_tipo: 'cliente', contenido: text
  }]);
  console.log('[IG] mensaje guardado — conv_id:', conv.id, '| error:', msgErr?.message || 'none');

  // Call AI agent
  console.log('[IG] llamando responderIA — conv_id:', conv.id);
  try {
    const { responderIA } = require('./agente-ia');
    const respuesta = await responderIA(conv.id, text);
    console.log('[IG] responderIA result — length:', respuesta?.length ?? 'null', '| preview:', respuesta?.slice(0, 80) || '(vacío)');
    if (respuesta) {
      console.log('[IG] enviando respuesta → psid:', psid);
      await sendInstagramMessage(psid, respuesta);
    } else {
      console.warn('[IG] responderIA devolvió vacío — no se envía nada');
    }
  } catch (e) {
    console.error('[IG] IA error:', e.message, '| stack:', e.stack?.split('\n')[1]);
    await sendInstagramMessage(psid, 'Hola 👋 Recibimos tu mensaje. Un asesor te contactará pronto.').catch(se => {
      console.error('[IG] fallback send error:', se.message);
    });
  }
}

module.exports = router;
