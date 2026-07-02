// src/services/imageProvider.js
// Adaptador intercambiable de proveedor de imágenes.
//
// Para agregar un nuevo proveedor:
//   1. Crear src/services/providers/<nombre>.js
//      que exporte generarImagen(prompt, opts) → Promise<{ buffer: Buffer, mimeType: string }>
//   2. Cambiar IMAGE_PROVIDER=<nombre> en las env vars de Vercel
//   No se requiere modificar este archivo.

const PROVIDER = process.env.IMAGE_PROVIDER ?? 'gemini';

async function generarImagen(prompt, opts = {}) {
  // require dinámico: el provider se carga solo cuando se necesita
  const provider = require(`./providers/${PROVIDER}`);
  return provider.generarImagen(prompt, opts);
}

module.exports = { generarImagen };
