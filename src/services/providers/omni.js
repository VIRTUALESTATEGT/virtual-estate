// src/services/providers/omni.js
// Proveedor Gemini Omni 1.1 Flash para generación asíncrona de video.
// Usa background mode para evitar el timeout de Vercel (iniciarVideo retorna <2s).
// iniciarVideo  → devuelve interaction.id (string)
// consultarVideo(id, { iniciado_en }) → { listo: false } | { listo: true, videoBuffer } | { listo: false, error }

const axios = require('axios');

const BASE  = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-omni-1.1-flash';

// Mapeo calidad → resolution. Ambos en 720p hasta confirmar costo/calidad de 1080p.
const RESOLUTION = {
  fast:    '720p',
  quality: '720p',
};

// Estados terminales de fallo. "failed"/"cancelled" son los de la doc de background-execution;
// "error"/"expired" se aceptan también en caso de que la API use variantes no documentadas.
const TERMINALES_FALLO = new Set(['failed', 'cancelled', 'error', 'expired']);

const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutos

function key() {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('GEMINI_API_KEY no configurada');
  return k;
}

// Api-Revision requerido para background mode según la doc de background-execution.
function authHeaders() {
  return {
    'x-goog-api-key':  key(),
    'Content-Type':    'application/json',
    'Api-Revision':    '2026-05-20',
  };
}

// Trunca strings base64 en un JSON serializado para que los logs sean legibles.
function truncateB64(jsonStr) {
  return jsonStr.replace(/"data":"([^"]{0,80})[^"]*"/g, '"data":"$1[…]"');
}

async function iniciarVideo(prompt, { calidad = 'fast', imagenInicial = null, esMultiClip = false } = {}) {
  const resolution = RESOLUTION[calidad] ?? RESOLUTION.fast;

  const input = [];
  if (imagenInicial?.data) {
    input.push({
      type:      'image',
      data:      imagenInicial.data,
      mime_type: imagenInicial.mimeType ?? 'image/png',
    });
  }

  // Clips de una orden multi-clip deben ser tomas continuas sin cortes internos.
  // No agregar si el prompt ya lo pide o si el usuario pidió explícitamente cortes/tomas múltiples.
  let textPrompt = prompt;
  if (esMultiClip) {
    const yaIncluye = /single continuous shot|no scene cuts/i.test(prompt);
    const pideCorts = /\b(scene cuts?|multiple\s+(takes?|shots?|scenes?)|cut\s+to|jump\s+cuts?|cross[\s-]?cut|quick\s+cuts?|inter[\s-]?cut)\b/i.test(prompt);
    if (!yaIncluye && !pideCorts) {
      textPrompt = `${prompt}. Single continuous shot, no scene cuts, no dialogue.`;
    }
  }
  input.push({ type: 'text', text: textPrompt });

  let data;
  try {
    const res = await axios.post(
      `${BASE}/interactions`,
      {
        model:           MODEL,
        input,
        response_format: { type: 'video', resolution },
        background:      true,
        store:           true,
      },
      { headers: authHeaders(), timeout: 30000 }
    );
    data = res.data;
  } catch (e) {
    const body   = e.response?.data;
    const detail = body ? JSON.stringify(body) : e.message;
    const hasImg = !!imagenInicial?.data;
    throw new Error(`Omni iniciar ${e.response?.status ?? 'ERR'} (conImagen=${hasImg}, resolución=${resolution}) — body: ${detail}`);
  }

  if (!data?.id) {
    throw new Error('Omni no devolvió interaction.id — respuesta: ' + JSON.stringify(data).slice(0, 200));
  }
  console.log('[OMNI] interacción iniciada:', data.id, '| status inicial:', data.status);
  return data.id;
}

// iniciado_en: ISO timestamp guardado por la ruta al iniciar el clip (fuente principal).
// Fallback: create_time/created_at de Google.
// Si ninguna referencia existe para un in_progress → loguear advertencia y seguir esperando (no expirar).
async function consultarVideo(interactionId, { iniciado_en = null } = {}) {
  let data;
  try {
    const res = await axios.get(
      `${BASE}/interactions/${interactionId}`,
      { headers: authHeaders(), timeout: 15000 }
    );
    data = res.data;
  } catch (e) {
    const body   = e.response?.data;
    const detail = body ? JSON.stringify(body) : e.message;
    throw new Error(`Omni ${e.response?.status ?? 'ERR'} al consultar "${interactionId}" — body: ${detail}`);
  }

  const status = data.status;
  console.log('[OMNI] poll', interactionId, '→ status:', status);

  // ── Fallos terminales ──────────────────────────────────────────────────────
  if (TERMINALES_FALLO.has(status)) {
    console.error('[OMNI] fallo terminal:', status, '— raw:', truncateB64(JSON.stringify(data)).slice(0, 800));
    const errMsg = data.error?.message ?? data.status_detail ?? `interacción ${status}`;
    return { listo: false, error: errMsg };
  }

  // ── En progreso ────────────────────────────────────────────────────────────
  if (status === 'in_progress') {
    // iniciado_en (nuestro) es la fuente principal; Google's create_time/created_at como respaldo.
    const startTime = iniciado_en ?? data.create_time ?? data.created_at;
    if (!startTime) {
      console.warn('[OMNI] in_progress sin referencia de tiempo para', interactionId, '— siguiendo esperando');
      return { listo: false };
    }
    const elapsedMs = Date.now() - new Date(startTime).getTime();
    if (elapsedMs > TIMEOUT_MS) {
      console.warn('[OMNI] timeout 10min, id:', interactionId, '| startTime:', startTime);
      return { listo: false, error: `Tiempo de espera agotado (último estado: ${status})` };
    }
    return { listo: false };
  }

  // ── Completado ─────────────────────────────────────────────────────────────
  if (status === 'completed') {
    // Log raw (b64 truncado) para verificar estructura en los primeros completions
    console.log('[OMNI] completed raw:', truncateB64(JSON.stringify(data)).slice(0, 800));

    const step         = (data.steps ?? []).find(s => s.type === 'model_output');
    const videoContent = (step?.content ?? []).find(c => c.type === 'video');

    if (!videoContent) {
      console.error('[OMNI] completed sin video en steps:', JSON.stringify(data.steps ?? []).slice(0, 400));
      return { listo: false, error: 'Omni completó pero no hay video en la respuesta' };
    }

    // Caso 1: base64 inline
    if (videoContent.data) {
      const videoBuffer = Buffer.from(videoContent.data, 'base64');
      console.log('[OMNI] video inline recibido, tamaño:', videoBuffer.length, 'bytes');
      return { listo: true, videoBuffer };
    }

    // Caso 2: URI (Files API)
    if (videoContent.uri) {
      const uriParts = videoContent.uri.split('/');
      const fileId   = uriParts[uriParts.length - 1].split('?')[0];
      console.log('[OMNI] video via Files API, fileId:', fileId);

      let fileData;
      try {
        const fileRes = await axios.get(
          `${BASE}/files/${fileId}`,
          { headers: authHeaders(), timeout: 10000 }
        );
        fileData = fileRes.data;
      } catch (e) {
        const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
        throw new Error(`Omni Files API ${e.response?.status ?? 'ERR'} para fileId "${fileId}" — body: ${detail}`);
      }

      console.log('[OMNI] Files API state:', fileData.state);

      if (fileData.state === 'PROCESSING') return { listo: false };
      if (fileData.state !== 'ACTIVE') {
        return { listo: false, error: `File state inesperado: ${fileData.state}` };
      }

      const dlRes = await axios.get(videoContent.uri, {
        headers:      { 'x-goog-api-key': key() },
        responseType: 'arraybuffer',
        timeout:      60000,
      });
      const videoBuffer = Buffer.from(dlRes.data);
      console.log('[OMNI] video descargado via URI, tamaño:', videoBuffer.length, 'bytes');
      return { listo: true, videoBuffer };
    }

    // Completed pero sin data ni uri
    console.error('[OMNI] videoContent sin data ni uri:', JSON.stringify(videoContent));
    return { listo: false, error: 'Video sin data ni uri en la respuesta de Omni' };
  }

  // ── Status desconocido ─────────────────────────────────────────────────────
  console.warn('[OMNI] status desconocido:', status, '— raw:', truncateB64(JSON.stringify(data)).slice(0, 800));
  const startTimeUnk = iniciado_en ?? data.create_time ?? data.created_at;
  if (!startTimeUnk) {
    console.warn('[OMNI] status desconocido sin referencia de tiempo para', interactionId, '— siguiendo esperando');
    return { listo: false };
  }
  const elapsedUnk = Date.now() - new Date(startTimeUnk).getTime();
  if (elapsedUnk > TIMEOUT_MS) {
    return { listo: false, error: `Tiempo de espera agotado (último estado: ${status})` };
  }
  return { listo: false };
}

module.exports = { iniciarVideo, consultarVideo };
