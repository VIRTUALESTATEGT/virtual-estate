// src/utils/fonts.js
// Configura fontconfig para que librsvg (usado por Sharp) encuentre los TTF
// bundleados en assets/fonts/. Sin esta configuración, librsvg ignora
// @font-face con data URIs y no tiene fuentes de sistema en Lambda.

const path = require('path');
const fs   = require('fs');

const FONTS_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');
const FC_DIR    = '/tmp/fontconfig';

let _setup = false;

function setupFontconfig() {
  if (_setup) return;
  fs.mkdirSync(FC_DIR, { recursive: true });
  fs.mkdirSync('/tmp/fontconfig-cache', { recursive: true });
  fs.writeFileSync(path.join(FC_DIR, 'fonts.conf'), `<?xml version="1.0"?>
<fontconfig>
  <dir>${FONTS_DIR}</dir>
  <cachedir>/tmp/fontconfig-cache</cachedir>
</fontconfig>`);
  process.env.FONTCONFIG_PATH = FC_DIR;
  _setup = true;
}

module.exports = { setupFontconfig };
