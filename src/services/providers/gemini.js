// src/services/providers/gemini.js
// Proveedor de imágenes: Gemini native image generation (Google AI Studio)
//
// Para cambiar de modelo: editar MODEL_ID (única constante a tocar).
// Para agregar un provider alternativo: crear providers/<nombre>.js con la
// misma interfaz — exports.generarImagen(prompt, opts) → { buffer, mimeType }
// Luego cambiar IMAGE_PROVIDER en las env vars de Vercel.

const axios = require('axios');

const MODEL_ID = 'gemini-2.5-flash-image';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

async function generarImagen(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY no configurada');

  const url = `${API_BASE}/${MODEL_ID}:generateContent?key=${key}`;

  const { data } = await axios.post(
    url,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] }
    },
    {
      timeout:      28000,
      responseType: 'json',
      headers:      { 'Content-Type': 'application/json' }
    }
  );

  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find(p => p.inlineData);

  if (!imagePart) {
    const preview = JSON.stringify(data).slice(0, 300);
    throw new Error(`Gemini no devolvió imagen. Respuesta: ${preview}`);
  }

  return {
    buffer:   Buffer.from(imagePart.inlineData.data, 'base64'),
    mimeType: imagePart.inlineData.mimeType || 'image/png'
  };
}

module.exports = { generarImagen };
