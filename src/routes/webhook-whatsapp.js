const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const supabase = require('../config/supabase');
const { sendWhatsAppMessage, notifyAdmin, isAdminNumber } = require('../utils/whatsapp');

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'virtual-estate-webhook';
const APP_SECRET   = process.env.WHATSAPP_APP_SECRET   || '';

// ── Webhook verification (GET) ────────────────────────────────────
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[Webhook] Verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ── Signature validation ──────────────────────────────────────────
function validateSignature(req) {
  if (!APP_SECRET) return true; // skip in dev
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', APP_SECRET)
    .update(req.rawBody || '')
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

// ── Incoming messages (POST) ──────────────────────────────────────
router.post('/', async (req, res) => {
  if (!validateSignature(req)) return res.sendStatus(403);
  res.sendStatus(200); // ACK immediately — process async

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value  = change?.value;
    if (!value?.messages?.length) return;

    const msg  = value.messages[0];
    const from = msg.from;
    const text = msg.text?.body?.trim() || '';
    if (!text) return;

    console.log(`[Webhook] Message from ${from}: ${text}`);

    if (isAdminNumber(from)) {
      await processAdminCommand(from, text);
    } else {
      await processClientMessage(from, text);
    }
  } catch (e) {
    console.error('[Webhook] Processing error:', e.message);
  }
});

// ── Admin command processor ────────────────────────────────────────
async function processAdminCommand(from, text) {
  const upper = text.toUpperCase().trim();

  // RESUMEN — conversation stats
  if (upper === 'RESUMEN') {
    const { data: activas } = await supabase
      .from('conversaciones_multicanal').select('id', { count: 'exact' }).eq('estado', 'activa');
    const { data: pendVerif } = await supabase
      .from('cliente_verificacion_identidad').select('id', { count: 'exact' }).eq('estado', 'pendiente');
    await sendWhatsAppMessage(from,
      `📊 *RESUMEN VIRTUAL ESTATE*\n` +
      `• Conversaciones activas: ${activas?.length ?? 0}\n` +
      `• Verificaciones pendientes: ${pendVerif?.length ?? 0}`
    );
    return;
  }

  // RESPUESTA: [texto] → save as dynamic instruction + forward to last active client
  const respMatch = text.match(/^RESPUESTA:\s*(.+)/is);
  if (respMatch) {
    const contenido = respMatch[1].trim();
    await supabase.from('instrucciones_ia_dinamicas').insert([{
      tipo: 'respuesta_personalizada', trigger: 'admin_manual', contenido, activa: true
    }]);
    await sendWhatsAppMessage(from, `✅ Instrucción guardada: "${contenido.substring(0, 60)}..."`);
    return;
  }

  // INSTRUCCIÓN: [trigger]: [contenido]
  const instrMatch = text.match(/^INSTRUCCIÓN:\s*(.+?):\s*(.+)/is);
  if (instrMatch) {
    const [, trigger, contenido] = instrMatch;
    await supabase.from('instrucciones_ia_dinamicas').insert([{
      tipo: 'politica', trigger: trigger.trim().toLowerCase(), contenido: contenido.trim(), activa: true
    }]);
    await sendWhatsAppMessage(from, `✅ Instrucción guardada para trigger: "${trigger.trim()}"`);
    return;
  }

  // FAQ [palabra]: [contenido]
  const faqMatch = text.match(/^FAQ\s+(.+?):\s*(.+)/is);
  if (faqMatch) {
    const [, trigger, contenido] = faqMatch;
    await supabase.from('instrucciones_ia_dinamicas').insert([{
      tipo: 'faq', trigger: trigger.trim().toLowerCase(), contenido: contenido.trim(), activa: true
    }]);
    await sendWhatsAppMessage(from, `✅ FAQ guardada: "${trigger.trim()}"`);
    return;
  }

  // RESPONDER [ID]: [texto]
  const responderMatch = text.match(/^RESPONDER\s+(\d+):\s*(.+)/is);
  if (responderMatch) {
    const [, convId, respuesta] = responderMatch;
    const { data: conv } = await supabase
      .from('conversaciones_multicanal').select('*').eq('id', convId).maybeSingle();
    if (!conv) { await sendWhatsAppMessage(from, `❌ Conversación #${convId} no encontrada`); return; }
    await supabase.from('mensajes').insert([{
      conversacion_id: Number(convId), remitente_tipo: 'agente_humano', contenido: respuesta.trim()
    }]);
    await supabase.from('conversaciones_multicanal')
      .update({ ultima_respuesta_tipo: 'agente_humano', timestamp: new Date().toISOString() })
      .eq('id', convId);
    if (conv.creada_por_cliente) await sendWhatsAppMessage(conv.creada_por_cliente, respuesta.trim());
    await sendWhatsAppMessage(from, `✅ Respuesta enviada a conversación #${convId}`);
    return;
  }

  // NOTA [ID]: [texto]
  const notaMatch = text.match(/^NOTA\s+(\d+):\s*(.+)/is);
  if (notaMatch) {
    const [, convId, nota] = notaMatch;
    await supabase.from('mensajes').insert([{
      conversacion_id: Number(convId), remitente_tipo: 'agente_humano',
      contenido: `[NOTA PRIVADA] ${nota.trim()}`, metadata_json: { privado: true }
    }]);
    await sendWhatsAppMessage(from, `📝 Nota guardada en conversación #${convId}`);
    return;
  }

  // BLOQUEAR [cliente_id]
  const bloquearMatch = text.match(/^BLOQUEAR\s+(\d+)/i);
  if (bloquearMatch) {
    const clienteId = bloquearMatch[1];
    await supabase.from('clientes').update({ bloqueado: true }).eq('id', clienteId);
    await sendWhatsAppMessage(from, `🚫 Cliente #${clienteId} bloqueado`);
    return;
  }

  // APROBAR [cliente_id]
  const aprobarMatch = text.match(/^APROBAR\s+(\d+)/i);
  if (aprobarMatch) {
    const clienteId = aprobarMatch[1];
    await supabase.from('cliente_verificacion_identidad')
      .update({ estado: 'verificado', verificacion_biometrica: true })
      .eq('cliente_id', clienteId).eq('estado', 'pendiente');
    await sendWhatsAppMessage(from, `✅ Cliente #${clienteId} verificado`);
    return;
  }

  // RECHAZAR [cliente_id]: [razon]
  const rechazarMatch = text.match(/^RECHAZAR\s+(\d+):\s*(.+)/is);
  if (rechazarMatch) {
    const [, clienteId, razon] = rechazarMatch;
    await supabase.from('cliente_verificacion_identidad')
      .update({ estado: 'rechazado', razon_rechazo: razon.trim() })
      .eq('cliente_id', clienteId).eq('estado', 'pendiente');
    await sendWhatsAppMessage(from, `❌ Verificación de cliente #${clienteId} rechazada`);
    return;
  }

  // SALIR [conversacion_id]
  const salirMatch = text.match(/^SALIR\s+(\d+)/i);
  if (salirMatch) {
    await supabase.from('conversaciones_multicanal')
      .update({ estado: 'cerrada' }).eq('id', salirMatch[1]);
    await sendWhatsAppMessage(from, `🔒 Conversación #${salirMatch[1]} cerrada`);
    return;
  }

  // OK [cotizacion_id] — approve quote
  const okMatch = text.match(/^OK\s+(\d+)/i);
  if (okMatch) {
    await supabase.from('cotizaciones')
      .update({ estado: 'enviada' }).eq('id', okMatch[1]);
    await sendWhatsAppMessage(from, `✅ Cotización #${okMatch[1]} aprobada`);
    return;
  }

  await sendWhatsAppMessage(from,
    `❓ Comando no reconocido. Comandos disponibles:\n` +
    `RESUMEN | RESPUESTA: [txt] | INSTRUCCIÓN: [trigger]: [txt]\n` +
    `FAQ [palabra]: [txt] | RESPONDER [ID]: [txt]\n` +
    `NOTA [ID]: [txt] | BLOQUEAR/APROBAR/RECHAZAR [ID]\n` +
    `SALIR [ID] | OK [cotizacion_id]`
  );
}

// ── Client message processor ──────────────────────────────────────
async function processClientMessage(from, text) {
  // Find or create conversation
  let { data: conv } = await supabase
    .from('conversaciones_multicanal')
    .select('*').eq('creada_por_cliente', from).eq('estado', 'activa').maybeSingle();

  if (!conv) {
    const { data: newConv } = await supabase
      .from('conversaciones_multicanal')
      .insert([{ canal: 'whatsapp', estado: 'activa', creada_por_cliente: from }])
      .select().single();
    conv = newConv;
  }

  // Save client message
  await supabase.from('mensajes').insert([{
    conversacion_id: conv.id, remitente_tipo: 'cliente', contenido: text
  }]);

  // Call AI agent via internal function (avoids extra HTTP round-trip)
  try {
    const { responderIA } = require('./agente-ia');
    const respuesta = await responderIA(conv.id, text);
    if (respuesta) await sendWhatsAppMessage(from, respuesta);
  } catch (e) {
    console.error('[Webhook] IA error:', e.message);
    await notifyAdmin(`⚠️ Error en agente IA para conv #${conv.id}: ${e.message}`);
  }
}

module.exports = router;
