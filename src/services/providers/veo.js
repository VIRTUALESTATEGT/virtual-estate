// src/services/providers/veo.js
// Proveedor Veo 3.1 Fast para generación asíncrona de video vía Gemini API.
// iniciarVideo  → devuelve el operation name (string)
// consultarVideo → { listo: false } | { listo: true, videoBuffer: Buffer }

const axios = require('axios');

const MODEL_ID = 'veo-3.1-fast-generate-preview';
const BASE     = 'https://generativelanguage.googleapis.com/v1beta';

function key() {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('GEMINI_API_KEY no configurada');
  return k;
}

async function iniciarVideo(prompt, { aspectRatio = '16:9', duracionSeg = 8, imagenInicial = null } = {}) {
  const instance = { prompt };
  if (imagenInicial?.data) {
    instance.image = {
      inlineData: {
        mimeType: imagenInicial.mimeType ?? 'image/png',
        data:     imagenInicial.data        // base64 string, sin prefijo data:...
      }
    };
  }
  let data;
  try {
    const res = await axios.post(
      `${BASE}/models/${MODEL_ID}:predictLongRunning?key=${key()}`,
      {
        instances:  [instance],
        parameters: { aspectRatio, sampleCount: 1, durationSeconds: Number(duracionSeg) }
      },
      { timeout: 30000 }
    );
    data = res.data;
  } catch (e) {
    const geminiBody = e.response?.data;
    const detail = geminiBody ? JSON.stringify(geminiBody) : e.message;
    const hasImg = !!imagenInicial?.data;
    throw new Error(`Veo iniciar ${e.response?.status ?? 'ERR'} (conImagen=${hasImg}, modelo=${MODEL_ID}) — body: ${detail}`);
  }
  // data.name = "models/veo-3.1-fast-generate-preview/operations/{id}"
  if (!data.name) throw new Error('Veo no devolvió operation name');
  return data.name;
}

async function consultarVideo(operationName) {
  const pollUrl = `${BASE}/${operationName}?key=${key()}`;
  let data;
  try {
    const res = await axios.get(pollUrl, { timeout: 15000 });
    data = res.data;
  } catch (e) {
    const geminiBody = e.response?.data;
    const detail = geminiBody ? JSON.stringify(geminiBody) : e.message;
    throw new Error(`Gemini ${e.response?.status ?? 'ERR'} al consultar operation "${operationName}" — URL: ${pollUrl.split('?')[0]} — body: ${detail}`);
  }

  if (!data.done) return { listo: false };

  const uri = data.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (!uri) return { listo: false };

  // Descarga el buffer del video (la URI requiere la API key)
  const sep = uri.includes('?') ? '&' : '?';
  const videoRes = await axios.get(`${uri}${sep}key=${key()}`, {
    responseType: 'arraybuffer',
    timeout: 45000
  });
  return { listo: true, videoBuffer: Buffer.from(videoRes.data) };
}

module.exports = { iniciarVideo, consultarVideo };
