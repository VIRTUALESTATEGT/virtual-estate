const express  = require('express');
const router   = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const supabase  = require('../config/supabase');
const { notifyAdmin } = require('../utils/whatsapp');

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const { buildSystemPrompt } = require('../config/system-prompt');

async function loadDynamicInstructions() {
  try {
    const { data } = await supabase
      .from('instrucciones_ia_dinamicas')
      .select('tipo, trigger, contenido')
      .eq('activa', true)
      .order('fecha_creacion', { ascending: false })
      .limit(20);
    if (!data?.length) return 'Sin instrucciones adicionales.';
    return data.map(i => `[${i.tipo.toUpperCase()}] ${i.trigger}: ${i.contenido}`).join('\n');
  } catch { return 'Sin instrucciones adicionales.'; }
}

async function getConversationHistory(conversacionId, limit = 20) {
  try {
    const { data } = await supabase
      .from('mensajes')
      .select('remitente_tipo, contenido')
      .eq('conversacion_id', conversacionId)
      .order('timestamp', { ascending: true })
      .limit(limit);
    if (!data?.length) return [];
    return data.map(m => ({
      role: m.remitente_tipo === 'cliente' ? 'user' : 'assistant',
      content: m.contenido
    })).filter(m => m.role === 'user' || m.role === 'assistant');
  } catch { return []; }
}

// Core function — used by webhook and HTTP endpoint
// canal: 'whatsapp' (default) | 'instagram' — controls which table gets updated
async function responderIA(conversacionId, mensajeCliente, canal = 'whatsapp') {
  console.log('[IA] responderIA iniciado — conv_id:', conversacionId, '| canal:', canal);

  console.log('[IA] cargando instrucciones dinámicas...');
  let t0 = Date.now();
  const instrucciones = await loadDynamicInstructions();
  console.log(`[IG-PERF] loadDynamicInstructions — ${Date.now() - t0}ms`);
  const systemPrompt = buildSystemPrompt(canal, instrucciones);

  // Load history from mensajes — works for all canals once conv lives in conversaciones_multicanal
  // 5s timeout safety net: if DB hangs, fall back to empty history rather than blocking
  console.log('[IA] cargando historial — conv_id:', conversacionId);
  let history = [];
  try {
    t0 = Date.now();
    history = await Promise.race([
      getConversationHistory(conversacionId),
      new Promise((_, reject) => setTimeout(() => reject(new Error('history timeout 5s')), 5000)),
    ]);
    console.log(`[IG-PERF] getConversationHistory — ${Date.now() - t0}ms | msgs: ${history.length}`);
  } catch (e) {
    console.warn('[IA] historial no disponible:', e.message, '— continuando sin contexto');
  }

  // Build messages array (history + new message)
  const messages = [...history];
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    messages.push({ role: 'user', content: mensajeCliente });
  }

  console.log('[IA] iniciando fetch a Claude...');
  console.log('[IA] CLAUDE_API_KEY present:', !!process.env.CLAUDE_API_KEY, '| length:', process.env.CLAUDE_API_KEY?.length || 0);
  console.log('[IA] mensajes a enviar:', messages.length, '| t:', new Date().toISOString());

  const CLAUDE_TIMEOUT_MS = 25000;

  async function callClaude(attempt) {
    console.log(`[IA] Claude fetch — attempt ${attempt} | timeout ${CLAUDE_TIMEOUT_MS}ms | t:`, new Date().toISOString());
    const fetchPromise = fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: systemPrompt,
        messages,
      }),
    });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Claude API timeout ${CLAUDE_TIMEOUT_MS / 1000}s`)), CLAUDE_TIMEOUT_MS));
    const fetchResponse = await Promise.race([fetchPromise, timeoutPromise]);
    if (!fetchResponse.ok) {
      const errorBody = await fetchResponse.text();
      console.error('[IA] Claude HTTP error:', fetchResponse.status, '| body:', errorBody.slice(0, 200));
      throw new Error(`Claude HTTP ${fetchResponse.status}`);
    }
    const data = await fetchResponse.json();
    console.log('[IA] Claude respondió — content length:', data.content?.[0]?.text?.length || 0, '| t:', new Date().toISOString());
    return data.content?.[0]?.text?.trim() || null;
  }

  let respuesta;
  try {
    respuesta = await callClaude(1);
  } catch (err) {
    console.error('[IA] Claude attempt 1 failed:', err.message, '— retrying...');
    try {
      respuesta = await callClaude(2);
    } catch (err2) {
      console.error('[IA] Claude attempt 2 failed:', err2.message, '— giving up');
      return null;
    }
  }

  if (!respuesta) return null;

  // Confidence heuristic: if the reply hedges, flag to admin
  const lowConfidence = /verificar con el equipo|te contacto en breve|no estoy seguro/i.test(respuesta);
  if (lowConfidence) {
    await notifyAdmin(
      `⚠️ *IA baja confianza* — Conv #${conversacionId}\n` +
      `Cliente: "${mensajeCliente.substring(0, 100)}"\n` +
      `IA: "${respuesta.substring(0, 100)}..."\n` +
      `Responde: RESPONDER ${conversacionId}: [tu respuesta]`
    );
  }

  // Save AI response — applies to all canals (conv now lives in conversaciones_multicanal)
  if (conversacionId) {
    console.log('[IA] guardando en mensajes...');
    let t0 = Date.now();
    await supabase.from('mensajes').insert([{
      conversacion_id: conversacionId,
      remitente_tipo: 'ia',
      contenido: respuesta,
      metadata_json: { low_confidence: lowConfidence }
    }]);
    console.log(`[IG-PERF] INSERT respuesta IA — ${Date.now() - t0}ms`);

    console.log('[IA] actualizando conversaciones_multicanal...');
    t0 = Date.now();
    await supabase.from('conversaciones_multicanal')
      .update({ ultima_respuesta_tipo: 'ia', timestamp: new Date().toISOString() })
      .eq('id', conversacionId);
    console.log(`[IG-PERF] UPDATE conversaciones_multicanal — ${Date.now() - t0}ms`);
  }

  console.log('[IA] completado — length:', respuesta.length);
  return respuesta;
}

// POST /api/agente-ia/responder
router.post('/responder', async (req, res) => {
  try {
    const { conversacion_id, mensaje } = req.body;
    if (!conversacion_id || !mensaje)
      return res.status(400).json({ error: 'conversacion_id y mensaje son requeridos' });

    const respuesta = await responderIA(Number(conversacion_id), mensaje);
    if (!respuesta) return res.status(500).json({ error: 'Sin respuesta de IA' });
    res.json({ respuesta });
  } catch (e) {
    console.error('[AgenteIA]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.responderIA = responderIA;
