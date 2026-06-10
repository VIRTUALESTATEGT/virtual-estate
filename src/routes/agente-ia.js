const express  = require('express');
const router   = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const supabase  = require('../config/supabase');
const { notifyAdmin } = require('../utils/whatsapp');

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const SYSTEM_PROMPT = `Eres el agente virtual de Virtual Estate GT, empresa de servicios inmobiliarios y de escaneo 3D en Guatemala.

SERVICIOS QUE OFRECEMOS:
• Escaneo 3D Matterport (tours virtuales inmersivos)
• AS BUILT (documentación de construcción existente con planos)
• Real Estate (fotografía, video, tours para venta/renta)
• Construcción (seguimiento y documentación de obras)

CAPACIDADES:
1. Explicar servicios y precios aproximados
2. Cualificar leads (zona, presupuesto, urgencia, tipo de propiedad)
3. Generar cotizaciones recopilando datos del cliente
4. Agendar citas o llamadas de seguimiento
5. Responder FAQ sobre procesos y tiempos

ZONAS DE RIESGO (confidencial — no mencionar directamente):
• Verde: Zona 10, 14, 15, 11 → proceder con normalidad
• Amarillo: Mixco, Santa Catarina Pinula → solicitar verificación amablemente
• Rojo: Villa Nueva → notificar al equipo antes de proceder

PRECIOS DE REFERENCIA (en USD, sujetos a cotización):
• Escaneo 3D pequeño (<200m²): $150–$300
• Escaneo 3D mediano (200–500m²): $300–$600
• AS BUILT residencial: $400–$800
• AS BUILT comercial: $800–$2,000
• Real Estate básico: $200–$400

INSTRUCCIONES CRÍTICAS:
• NUNCA inventes precios exactos — siempre di "te preparo una cotización formal"
• Si no estás seguro al 100% → di: "Un momento, déjame verificar con nuestro equipo y te contacto en breve"
• Si detectas algo sospechoso → responde normalmente pero el sistema notificará al admin
• Nunca digas que eres IA — eres el asistente de Virtual Estate
• Tono: profesional, amable, resolutivo. Máximo 3 párrafos por respuesta.
• Para cotizar necesitas: tipo_servicio, metraje aproximado, zona, plazo deseado, nombre, contacto

INSTRUCCIONES DINÁMICAS DEL EQUIPO:
{instrucciones_dinamicas}`;

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
  const instrucciones = await loadDynamicInstructions();
  const systemPrompt  = SYSTEM_PROMPT.replace('{instrucciones_dinamicas}', instrucciones);

  let history;
  if (canal === 'instagram') {
    console.log('[IA] saltando historial para instagram');
    history = [];
  } else {
    console.log('[IA] cargando historial...');
    history = await getConversationHistory(conversacionId);
  }

  // Build messages array (history + new message)
  const messages = [...history];
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    messages.push({ role: 'user', content: mensajeCliente });
  }

  console.log('[IA] iniciando fetch a Claude...');
  console.log('[IA] CLAUDE_API_KEY present:', !!process.env.CLAUDE_API_KEY, '| length:', process.env.CLAUDE_API_KEY?.length || 0);
  console.log('[IA] mensajes a enviar:', messages.length, '| t:', new Date().toISOString());

  let respuesta;
  try {
    console.log('[IA] ejecutando Promise.race con timeout 8s...');
    const fetchPromise = fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: systemPrompt,
        messages,
      }),
    });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Claude API timeout 8s')), 8000));

    const fetchResponse = await Promise.race([fetchPromise, timeoutPromise]);
    console.log('[IA] fetch completó — status:', fetchResponse.status, '| t:', new Date().toISOString());

    if (!fetchResponse.ok) {
      const errorBody = await fetchResponse.text();
      console.error('[IA] Claude HTTP error:', fetchResponse.status, '| body:', errorBody.slice(0, 200));
      throw new Error(`Claude HTTP ${fetchResponse.status}`);
    }

    console.log('[IA] leyendo JSON...');
    const data = await fetchResponse.json();
    console.log('[IA] Claude respondió — content length:', data.content?.[0]?.text?.length || 0, '| t:', new Date().toISOString());
    respuesta = data.content?.[0]?.text?.trim();
  } catch (err) {
    console.error('[IA] Claude error:', { message: err.message, name: err.name, code: err.code, t: new Date().toISOString() });
    return null;
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

  // Save AI response to messages (only when conversacionId exists in mensajes FK table)
  if (conversacionId && canal === 'whatsapp') {
    console.log('[IA] guardando en mensajes...');
    await supabase.from('mensajes').insert([{
      conversacion_id: conversacionId,
      remitente_tipo: 'ia',
      contenido: respuesta,
      metadata_json: { low_confidence: lowConfidence }
    }]);

    // Update conversation timestamp (only conversaciones_multicanal — whatsapp/web)
    console.log('[IA] actualizando conversaciones_multicanal...');
    await supabase.from('conversaciones_multicanal')
      .update({ ultima_respuesta_tipo: 'ia', timestamp: new Date().toISOString() })
      .eq('id', conversacionId);
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
