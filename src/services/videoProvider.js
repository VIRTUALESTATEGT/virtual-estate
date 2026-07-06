// src/services/videoProvider.js
// Adaptador intercambiable de proveedor de video (mismo patrón que imageProvider.js).
// Para agregar un proveedor: crear src/services/providers/<nombre>.js
// que exporte iniciarVideo y consultarVideo, luego cambiar VIDEO_PROVIDER en env vars.

const PROVIDER = process.env.VIDEO_PROVIDER ?? 'veo';

async function iniciarVideo(prompt, opts = {}) {
  const provider = require(`./providers/${PROVIDER}`);
  return provider.iniciarVideo(prompt, opts);
}

async function consultarVideo(operationName) {
  const provider = require(`./providers/${PROVIDER}`);
  return provider.consultarVideo(operationName);
}

module.exports = { iniciarVideo, consultarVideo };
