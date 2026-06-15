const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const crypto   = require('crypto');
const supabase = require('../config/supabase');
const { getMetaToken } = require('./meta-tokens');

const IG_BASE        = 'https://graph.instagram.com/v23.0';
const VERIFY_TOKEN   = process.env.INSTAGRAM_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || 'virtual-estate-webhook';
const ADMIN_PSID     = process.env.INSTAGRAM_ADMIN_PSID || '';
const IG_APP_SECRET  = process.env.INSTAGRAM_APP_SECRET || process.env.WHATSAPP_APP_SECRET || '';
// IG_SIGNATURE_ENFORCE=true → reject 403 on mismatch; false (default) → log-only
const IG_SIG_ENFORCE = process.env.IG_SIGNATURE_ENFORCE === 'true';

// ── Signature validation (same algorithm as WhatsApp) ────────────────────────
function validateIGSignature(req) {
  if (!IG_APP_SECRET) return { valid: true, reason: 'no_secret_configured' };
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return { valid: false, reason: 'missing_header' };
  const expected = 'sha256=' + crypto
    .createHmac('sha256', IG_APP_SECRET)
    .update(req.rawBody || '')
    .digest('hex');
  const valid = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  return { valid, received: sig, expected };
}

// ── Send a text reply to an Instagram DM sender (by PSID) ────────────────────
async function sendInstagramMessage(recipientId, text) {
  const token = await getMetaToken('instagram');
  if (!token) {
    console.warn('[IG] No Instagram token available — skipping send');
    return null;
  }
  try {
    const { data } = await axios.post(
      `${IG_BASE}/me/messages`,
      { recipient: { id: recipientId }, message: { text } },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
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
  // Signature check — same HMAC-SHA256 pattern as WhatsApp
  const sigResult = validateIGSignature(req);
  if (!sigResult.valid) {
    console.warn('[IG] Signature mismatch — enforce:', IG_SIG_ENFORCE,
      '| reason:', sigResult.reason,
      '| received:', sigResult.received,
      '| expected:', sigResult.expected);
    if (IG_SIG_ENFORCE) return res.sendStatus(403);
  } else if (IG_APP_SECRET) {
    console.log('[IG] Signature valid ✅');
  }

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
      .from('conversaciones_multicanal').select('id', { count: 'exact' }).eq('canal', 'instagram').eq('estado', 'activa');
    await sendInstagramMessage(psid,
      `📊 RESUMEN VIRTUAL ESTATE\n• Conversaciones Instagram activas: ${activas?.length ?? 0}`
    );
    return;
  }

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

  await sendInstagramMessage(psid, `❓ Comandos disponibles:\nRESUMEN | RESPONDER [ID]: [texto]`);
}

// ── DB helper: race any Supabase promise against a 5s timeout ────────────────
function dbWithTimeout(promise, label) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timeout 5s`)), 5000));
  return Promise.race([promise, timeout]);
}

// ── Client message processor ──────────────────────────────────────────────────
async function processClientMessage(psid, text) {
  console.log('[IG] processClientMessage ▶ psid:', psid, '| text:', text.slice(0, 60));

  // Find or create conversation in conversaciones_multicanal (same table as WhatsApp)
  // Uses service_role key — bypasses RLS. 5s timeout as safety net against hangs.
  let convId = null;
  try {
    const { data: existing } = await dbWithTimeout(
      supabase.from('conversaciones_multicanal')
        .select('id')
        .eq('creada_por_cliente', psid)
        .eq('estado', 'activa')
        .maybeSingle(),
      'SELECT conv'
    );
    if (existing?.id) {
      convId = existing.id;
      console.log('[IG] existing conv — id:', convId);
    } else {
      const { data: newConv, error: insertErr } = await dbWithTimeout(
        supabase.from('conversaciones_multicanal')
          .insert([{ canal: 'instagram', estado: 'activa', creada_por_cliente: psid }])
          .select('id')
          .single(),
        'INSERT conv'
      );
      if (insertErr) {
        console.error('[IG] conv insert error:', insertErr.message, '| code:', insertErr.code);
      } else {
        convId = newConv?.id ?? null;
        console.log('[IG] new conv — id:', convId);
      }
    }
  } catch (e) {
    console.error('[IG] conv DB error (continuing without conv):', e.message);
  }

  // Save client message (best-effort — FK now valid since conv is in conversaciones_multicanal)
  if (convId) {
    try {
      await dbWithTimeout(
        supabase.from('mensajes')
          .insert([{ conversacion_id: convId, remitente_tipo: 'cliente', contenido: text }]),
        'INSERT mensaje'
      );
    } catch (e) {
      console.error('[IG] mensajes insert error:', e.message);
    }
  }

  // Call AI agent
  console.log('[IG-IA-START] iniciando responderIA | conv_id:', convId, '| CLAUDE_API_KEY present:', !!process.env.CLAUDE_API_KEY, '| t:', new Date().toISOString());
  try {
    const { responderIA } = require('./agente-ia');
    const respuesta = await responderIA(convId, text, 'instagram');
    console.log('[IG] responderIA result — length:', respuesta?.length ?? 'null');
    if (respuesta) {
      console.log('[IG] enviando respuesta → psid:', psid);
      await sendInstagramMessage(psid, respuesta);
    } else {
      console.warn('[IG] responderIA devolvió vacío — enviando mensaje de respaldo');
      await sendInstagramMessage(psid, 'Dame un momento, en breve te atiendo 🙏')
        .catch(se => console.error('[IG] fallback send error:', se.message));
    }
  } catch (e) {
    console.error('[IG] IA error:', e.message);
    await sendInstagramMessage(psid, 'Dame un momento, en breve te atiendo 🙏')
      .catch(se => console.error('[IG] fallback send error:', se.message));
  }
}

module.exports = router;
