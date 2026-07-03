// src/services/brandOverlay.js
// Aplica overlay de logo sobre un buffer de imagen.
// Siempre devuelve { overlayBuffer, originalBuffer } — si algo falla devuelve
// el original sin modificar para no bloquear la generación.

const sharp = require('sharp');
const axios = require('axios');

const DIMS = {
  '1:1':  { w: 1080, h: 1080 },
  '4:5':  { w: 1080, h: 1350 },
  '9:16': { w: 1080, h: 1920 },
  '16:9': { w: 1200, h: 675  }
};

// Mapeo tamaño → porcentaje del ancho de imagen
const TAMANO_PCT = { pequeno: 0.10, mediano: 0.15, grande: 0.22 };

// Calcula top/left del logo según posición y dimensiones
function calcLogoPos(logoPosicion, { w, h, logoW, logoH, margin }) {
  switch (logoPosicion) {
    case 'inferior-izquierda': return { top: h - logoH - margin, left: margin };
    case 'superior-derecha':   return { top: margin, left: w - logoW - margin };
    case 'superior-izquierda': return { top: margin, left: margin };
    case 'centro':             return { top: Math.round((h - logoH) / 2), left: Math.round((w - logoW) / 2) };
    case 'inferior-derecha':
    default:                   return { top: h - logoH - margin, left: w - logoW - margin };
  }
}

async function aplicarOverlay(buffer, {
  formato      = '1:1',
  identidad    = {},
  logoPosicion = 'inferior-derecha',
  logoTamano   = 'mediano'
} = {}) {
  const originalBuffer = buffer;

  try {
    const { w, h } = DIMS[formato] ?? DIMS['1:1'];

    const pipeline = sharp(buffer).resize(w, h, { fit: 'cover', position: 'centre' });

    // 'sin-logo' o sin URL → imagen limpia redimensionada
    if (logoPosicion === 'sin-logo' || !identidad?.logo_url?.trim()) {
      const overlayBuffer = await pipeline.png().toBuffer();
      return { overlayBuffer, originalBuffer };
    }

    // Descargar y redimensionar logo
    const pct    = TAMANO_PCT[logoTamano] ?? TAMANO_PCT.mediano;
    const logoW  = Math.round(w * pct);
    const margin = Math.round(w * 0.03);

    let logoComposite;
    try {
      const res = await axios.get(identidad.logo_url.trim(), { responseType: 'arraybuffer', timeout: 5000 });
      const logoResized = await sharp(Buffer.from(res.data))
        .resize(logoW, null, { fit: 'inside' })
        .png()
        .toBuffer();
      const { height: logoH } = await sharp(logoResized).metadata();
      const { top, left } = calcLogoPos(logoPosicion, { w, h, logoW, logoH: logoH ?? logoW, margin });
      logoComposite = { input: logoResized, top, left };
    } catch (e) {
      console.warn('[brandOverlay] logo no disponible:', e.message);
    }

    const overlayBuffer = logoComposite
      ? await pipeline.composite([logoComposite]).png().toBuffer()
      : await pipeline.png().toBuffer();

    return { overlayBuffer, originalBuffer };

  } catch (e) {
    console.error('[brandOverlay] error — devolviendo original:', e.message);
    return { overlayBuffer: originalBuffer, originalBuffer };
  }
}

module.exports = { aplicarOverlay };
