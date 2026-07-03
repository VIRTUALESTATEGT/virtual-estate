// src/utils/fonts.js
// Carga los archivos WOFF2 de assets/fonts/ como base64 para embeber
// en SVG vía @font-face data URI. Sin dependencia de fontconfig ni sistema.
// Se carga una sola vez en memoria (lazy singleton).

const path = require('path');
const fs   = require('fs');

const FONTS_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');

let _cache = null;

function getFonts() {
  if (_cache) return _cache;
  const load = (file) =>
    fs.readFileSync(path.join(FONTS_DIR, file)).toString('base64');
  _cache = {
    montserratRegular: load('Montserrat-Regular.woff2'),
    montserratBold:    load('Montserrat-Bold.woff2'),
    ralewaySemiBold:   load('Raleway-SemiBold.woff2')
  };
  return _cache;
}

// Devuelve el bloque <style> con los @font-face listos para insertar en SVG
function fontFaceStyle() {
  const f = getFonts();
  return `<style>
    @font-face { font-family:'Montserrat'; font-weight:400;
      src:url('data:font/woff2;base64,${f.montserratRegular}') format('woff2'); }
    @font-face { font-family:'Montserrat'; font-weight:700;
      src:url('data:font/woff2;base64,${f.montserratBold}') format('woff2'); }
    @font-face { font-family:'Raleway'; font-weight:600;
      src:url('data:font/woff2;base64,${f.ralewaySemiBold}') format('woff2'); }
  </style>`;
}

module.exports = { getFonts, fontFaceStyle };
