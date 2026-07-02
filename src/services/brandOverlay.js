// src/services/brandOverlay.js
// Aplica overlay de marca (logo + franja de nombre) sobre un buffer de imagen.
// Siempre devuelve { overlayBuffer, originalBuffer } — si algo falla, ambos
// apuntan al buffer original para no bloquear la generación.

const sharp = require('sharp');
const axios = require('axios');

// Dimensiones canónicas por formato
const DIMS = {
  '1:1':  { w: 1080, h: 1080 },
  '4:5':  { w: 1080, h: 1350 },
  '9:16': { w: 1080, h: 1920 },
  '16:9': { w: 1200, h: 675  }
};

function escXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function aplicarOverlay(buffer, { formato = '1:1', identidad = {} } = {}) {
  const originalBuffer = buffer;

  try {
    const { w, h } = DIMS[formato] ?? DIMS['1:1'];
    const composites = [];

    // ── Logo (esquina inferior derecha) ──────────────────────────────────
    const logoUrl = identidad?.logo_url?.trim();
    if (logoUrl) {
      try {
        const res = await axios.get(logoUrl, { responseType: 'arraybuffer', timeout: 5000 });
        const logoW      = Math.round(w * 0.15);
        const margin     = Math.round(w * 0.03);
        const logoResized = await sharp(Buffer.from(res.data))
          .resize(logoW, null, { fit: 'inside' })
          .png()
          .toBuffer();
        const { height: logoH } = await sharp(logoResized).metadata();
        composites.push({
          input: logoResized,
          top:  h - (logoH ?? logoW) - margin,
          left: w - logoW - margin
        });
      } catch (e) {
        console.warn('[brandOverlay] logo no disponible:', e.message);
      }
    }

    // ── Franja inferior con nombre del negocio ───────────────────────────
    const nombre = (identidad?.nombre_negocio ?? '').trim();
    if (nombre) {
      const stripH   = Math.max(Math.round(h * 0.055), 32);
      const fontSize = Math.max(Math.round(stripH * 0.45), 14);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${stripH}">
        <rect width="${w}" height="${stripH}" fill="rgba(13,26,20,0.80)"/>
        <text x="${Math.round(w / 2)}" y="${Math.round(stripH * 0.70)}"
              font-family="system-ui,Arial,sans-serif"
              font-size="${fontSize}"
              fill="#F5F0E8"
              text-anchor="middle"
              letter-spacing="2">
          ${escXml(nombre.toUpperCase())}
        </text>
      </svg>`;
      composites.push({ input: Buffer.from(svg), top: h - stripH, left: 0 });
    }

    // Sin datos de marca → devolver original redimensionado (sin overlay)
    const pipeline = sharp(buffer).resize(w, h, { fit: 'cover', position: 'centre' });
    const overlayBuffer = composites.length
      ? await pipeline.composite(composites).png().toBuffer()
      : await pipeline.png().toBuffer();

    return { overlayBuffer, originalBuffer };

  } catch (e) {
    console.error('[brandOverlay] error — devolviendo original:', e.message);
    return { overlayBuffer: originalBuffer, originalBuffer };
  }
}

module.exports = { aplicarOverlay };
