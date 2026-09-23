const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const crypto   = require('crypto');
const supabase = require('../config/supabase');
const { getMetaToken } = require('./meta-tokens');

const FB_BASE        = 'https://graph.facebook.com/v19.0';
const VERIFY_TOKEN   = process.env.MESSENGER_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || 'virtual-estate-webhook';
const ADMIN_PSID     = process.env.MESSENGER_ADMIN_PSID || '';
const FB_APP_SECRET  = process.env.MESSENGER_APP_SECRET || process.env.WHATSAPP_APP_SECRET || '';
const FB_SIG_ENFORCE = process.env.FB_SIGNATURE_ENFORCE === 'true';

// ── Signature validation ──────────────────────────────────────────────────────
function validateFBSignature(req) {
  if (!FB_APP_SECRET) return { valid: true, reason: 'no_secret_configured' };
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return { valid: false, reason: 'missing_header' };
  const expected = 'sha256=' + crypto
    .createHmac('sha256', FB_APP_SECRET)
    .update(req.rawBody || '')
    .digest('hex');
  const valid = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  return { valid, received: sig, expected };
}

// ── Send a text reply to a Messenger PSID ────────────────────────────────────
async function sendMessengerMessage(recipientId, text) {
  const token = await getMetaToken('messenger');
  if (!token) {
    console.warn('[FB] No Messenger token available — skipping send');
    return null;
  }
  try {
    const { data } = await axios.post(
      `${FB_BASE}/me/messages`,
      { recipient: { id: recipientId }, message: { text } },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    console.log('[FB] sendMessage OK → recipientId:', recipientId, '| msg_id:', data?.message_id);
    return data;
  } catch (e) {
    const metaErr = e.response?.data?.error;
    console.error('[FB] sendMessage error — HTTP:', e.response?.status, '| body:', JSON.stringify(e.response?.data || e.message));
    throw new Error(metaErr ? `Meta API error ${metaErr.code}: ${metaErr.message}` : e.message);
  }
}

// ── Webhook verification (GET) ────────────────────────────────────────────────
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  console.log('[FB] verify — mode:', mode, '| token match:', token === VERIFY_TOKEN);
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[FB] Webhook verified ✅');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ── Incoming messages (POST) ──────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const sigResult = validateFBSignature(req);
  if (!sigResult.valid) {
    console.warn('[FB] Signature mismatch — enforce:', FB_SIG_ENFORCE,
      '| reason:', sigResult.reason,
      '| received:', sigResult.received,
      '| expected:', sigResult.expected);
    if (FB_SIG_ENFORCE) return res.sendStatus(403);
  } else if (FB_APP_SECRET) {
    console.log('[FB] Signature valid ✅');
  }

  // Messenger payload: object='page', entry[0].messaging[0]
  // Only process 'page' object events (guards against Instagram events hitting this endpoint)
  const body = req.body;
  if (body?.object !== 'page') {
    console.log('[FB] Ignoring non-page object:', body?.object);
    return res.sendStatus(200);
  }

  try {
    const entry     = body?.entry?.[0];
    const messaging = entry?.messaging?.[0];

    if (messaging && !messaging.message?.is_echo) {
      const senderId = messaging.sender?.id;
      const text     = messaging.message?.text?.trim() || '';

      if (senderId && text) {
        console.log(`[FB] Message from PSID ${senderId}: ${text.slice(0, 80)}`);
        if (ADMIN_PSID && senderId === ADMIN_PSID) {
          await processAdminCommand(senderId, text);
        } else {
          await processClientMessage(senderId, text);
        }
      }
    }
  } catch (e) {
    console.error('[FB] Processing error:', e.message, '| stack:', e.stack?.split('\n')[1]);
  }

  res.sendStatus(200);
});

// ── Admin command processor ───────────────────────────────────────────────────
async function processAdminCommand(psid, text) {
  const upper = text.toUpperCase().trim();

  if (upper === 'RESUMEN') {
    const { data: activas } = await supabase
      .from('conversaciones_multicanal').select('id', { count: 'exact' }).eq('canal', 'messenger').eq('estado', 'activa');
    await sendMessengerMessage(psid,
      `📊 RESUMEN VIRTUAL ESTATE\n• Conversaciones Messenger activas: ${activas?.length ?? 0}`
    );
    return;
  }

  const responderMatch = text.match(/^RESPONDER\s+(\d+):\s*(.+)/is);
  if (responderMatch) {
    const convId   = Number(responderMatch[1]);
    const respuesta = responderMatch[2].trim();
    const { data: conv } = await supabase
      .from('conversaciones_multicanal').select('creada_por_cliente').eq('id', convId).maybeSingle();
    if (!conv) { await sendMessengerMessage(psid, `❌ Conversación #${convId} no encontrada`); return; }
    if (conv.creada_por_cliente) {
      await sendMessengerMessage(conv.creada_por_cliente, respuesta.trim());
    }
    await sendMessengerMessage(psid, `✅ Respuesta enviada a conversación #${convId}`);
    return;
  }

  await sendMessengerMessage(psid, `❓ Comandos disponibles:\nRESUMEN | RESPONDER [ID]: [texto]`);
}

// ── Rescue timeout for conv queries ──────────────────────────────────────────
function dbWithTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout 5s`)), 5000)),
  ]);
}

// ── Client message processor ──────────────────────────────────────────────────
async function processClientMessage(psid, text) {
  console.log('[FB] processClientMessage ▶ psid:', psid, '| text:', text.slice(0, 60));

  let convId = null;
  let esPrimerContacto = false;
  try {
    let t0 = Date.now();
    const { data: existing } = await dbWithTimeout(
      supabase.from('conversaciones_multicanal')
        .select('id, timestamp')
        .eq('creada_por_cliente', psid)
        .eq('canal', 'messenger')
        .eq('estado', 'activa')
        .maybeSingle(),
      'SELECT conv'
    );
    console.log('[FB-PERF] SELECT conv —', Date.now() - t0, 'ms');

    if (existing?.id) {
      const lastActivity  = new Date(existing.timestamp || 0).getTime();
      const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
      if (lastActivity < threeHoursAgo) {
        console.log('[FB] 3h inactividad — cerrando conv', existing.id, 'y creando nueva');
        await supabase.from('conversaciones_multicanal')
          .update({ estado: 'cerrada' }).eq('id', existing.id);
      } else {
        convId = existing.id;
        console.log('[FB] existing conv — id:', convId);
      }
    }

    if (!convId) {
      t0 = Date.now();
      const { data: newConv, error: insertErr } = await dbWithTimeout(
        supabase.from('conversaciones_multicanal')
          .insert([{ canal: 'messenger', estado: 'activa', creada_por_cliente: psid }])
          .select('id')
          .single(),
        'INSERT conv'
      );
      console.log('[FB-PERF] INSERT conv —', Date.now() - t0, 'ms');
      if (insertErr) {
        console.error('[FB] conv insert error:', insertErr.message, '| code:', insertErr.code);
      } else {
        convId = newConv?.id ?? null;
        esPrimerContacto = true;
        console.log('[FB] new conv — id:', convId, '| es_primer_contacto: true');
      }
    }
  } catch (e) {
    console.error('[FB] conv DB error (continuing without conv):', e.message);
  }

  console.log('[FB-IA-START] iniciando responderIA | conv_id:', convId, '| CLAUDE_API_KEY present:', !!process.env.CLAUDE_API_KEY, '| t:', new Date().toISOString());
  let respuesta = null;
  try {
    const { responderIA } = require('./agente-ia');
    respuesta = await responderIA(convId, text, 'messenger', esPrimerContacto);
    console.log('[FB] responderIA result — length:', respuesta?.length ?? 'null');
  } catch (e) {
    console.error('[FB] IA error:', e.message);
  }

  try {
    if (respuesta) {
      console.log('[FB] enviando respuesta → psid:', psid);
      await sendMessengerMessage(psid, respuesta);
    } else {
      console.warn('[FB] responderIA devolvió vacío — enviando mensaje de respaldo');
      await sendMessengerMessage(psid, 'Dame un momento, en breve te atiendo 🙏');
    }
  } catch (e) {
    console.error('[FB] sendMessage error:', e.message);
  }

  if (convId) {
    supabase.from('mensajes')
      .insert([{ conversacion_id: convId, remitente_tipo: 'cliente', contenido: text }])
      .then(() => {})
      .catch(e => console.error('[FB] mensajes insert error:', e.message));
  }
}

module.exports = router;
