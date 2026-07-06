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

async function iniciarVideo(prompt, { aspectRatio = '16:9', duracionSeg = 8 } = {}) {
  const { data } = await axios.post(
    `${BASE}/models/${MODEL_ID}:predictLongRunning?key=${key()}`,
    {
      instances:  [{ prompt }],
      parameters: { aspectRatio, sampleCount: 1, durationSeconds: Number(duracionSeg) }
    },
    { timeout: 30000 }
  );
  // data.name = "models/veo-3.1-fast-generate-preview/operations/{id}"
  if (!data.name) throw new Error('Veo no devolvió operation name');
  return data.name;
}

async function consultarVideo(operationName) {
  const { data } = await axios.get(
    `${BASE}/${operationName}?key=${key()}`,
    { timeout: 15000 }
  );

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
