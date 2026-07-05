// src/services/templateEngine.js
// Renderiza plantillas compuestas (2 columnas): descarga las fotos IA de cada panel
// y compone la imagen final con textos Montserrat/Raleway vía SVG+Sharp.
// Las fotos de los paneles llegan ya subidas a Storage (imagen_url por panel).

const sharp = require('sharp');
const axios = require('axios');
const { setupFontconfig } = require('../utils/fonts');
const { aplicarOverlay }  = require('./brandOverlay');

const DIMS = {
  '1:1':  { w: 1080, h: 1080 },
  '4:5':  { w: 1080, h: 1350 },
  '9:16': { w: 1080, h: 1920 },
  '16:9': { w: 1200, h: 675  }
};

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function renderComparativa2Col(paneles, {
  formato       = '1:1',
  identidad     = {},
  logoPosicion  = 'inferior-derecha',
  logoTamano    = 'mediano',
  logoTamanoPct = null
} = {}) {
  setupFontconfig();
  const { w, h } = DIMS[formato] ?? DIMS['1:1'];
  const pw = Math.floor(w / 2);

  // Descargar y recortar fotos de cada panel en paralelo
  const panelBufs = await Promise.all(paneles.map(async (p) => {
    if (!p.imagen_url) return null;
    try {
      const { data } = await axios.get(p.imagen_url, { responseType: 'arraybuffer', timeout: 12000 });
      return sharp(Buffer.from(data)).resize(pw, h, { fit: 'cover', position: 'centre' }).png().toBuffer();
    } catch { return null; }
  }));

  const col      = identidad?.colores ?? {};
  const acento   = col.acento   ?? '#C19259';
  const primario = col.primario ?? '#2D5016';

  // Banda de texto: 30% inferior de cada panel
  const bandH = Math.round(h * 0.30);
  const bandY = h - bandH;
  const fs = {
    titulo:    Math.max(18, Math.round(h * 0.033)),
    subtitulo: Math.max(13, Math.round(h * 0.020)),
    precio:    Math.max(15, Math.round(h * 0.026)),
    detalle:   Math.max(11, Math.round(h * 0.017)),
  };

  const svgPanels = paneles.map((p, i) => {
    const cx = i === 0 ? Math.floor(pw / 2) : pw + Math.floor(pw / 2);
    const y1 = bandY + Math.round(bandH * 0.25);
    const y2 = bandY + Math.round(bandH * 0.47);
    const y3 = bandY + Math.round(bandH * 0.67);
    const y4 = bandY + Math.round(bandH * 0.86);
    return `
    <rect x="${i * pw}" y="${bandY}" width="${pw}" height="${bandH}" fill="#0D1A14" fill-opacity="0.88"/>
    <text x="${cx}" y="${y1}" text-anchor="middle" font-family="Raleway" font-weight="600" font-size="${fs.titulo}" fill="${acento}">${esc(p.titulo)}</text>
    <text x="${cx}" y="${y2}" text-anchor="middle" font-family="Montserrat" font-weight="400" font-size="${fs.subtitulo}" fill="#F5F0E8">${esc(p.subtitulo)}</text>
    <text x="${cx}" y="${y3}" text-anchor="middle" font-family="Montserrat" font-weight="700" font-size="${fs.precio}" fill="${primario}">${esc(p.precio)}</text>
    <text x="${cx}" y="${y4}" text-anchor="middle" font-family="Montserrat" font-weight="400" font-size="${fs.detalle}" fill="#7A8D85">${esc(p.detalle)}</text>`;
  }).join('');

  const svgOverlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    ${svgPanels}
    <line x1="${pw}" y1="0" x2="${pw}" y2="${h}" stroke="${acento}" stroke-width="3" opacity="0.5"/>
    </svg>`
  );

  const composites = [];
  if (panelBufs[0]) composites.push({ input: panelBufs[0], top: 0, left: 0 });
  if (panelBufs[1]) composites.push({ input: panelBufs[1], top: 0, left: pw });
  composites.push({ input: svgOverlay, top: 0, left: 0 });

  const composed = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 13, g: 26, b: 20, alpha: 1 } } })
    .composite(composites)
    .png()
    .toBuffer();

  const { overlayBuffer } = await aplicarOverlay(composed, {
    formato, identidad, logoPosicion, logoTamano, logoTamanoPct
  });
  return overlayBuffer;
}

module.exports = { renderComparativa2Col };
