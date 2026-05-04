const fs   = require('fs');
const path = require('path');

const ROOT  = path.join(__dirname, '..');
const OUT   = path.join(ROOT, 'public');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    const s = path.join(src, item);
    const d = path.join(dest, item);
    fs.statSync(s).isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

fs.mkdirSync(OUT, { recursive: true });

// HTML pages
const pages = ['index','admin','portal','real-estate','as-built','construccion'];
for (const p of pages) {
  const src = path.join(ROOT, `${p}.html`);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(OUT, `${p}.html`));
    console.log(`  ✓  ${p}.html`);
  }
}

// Static asset directories
for (const dir of ['images', 'documentos']) {
  const src = path.join(ROOT, dir);
  if (fs.existsSync(src)) {
    copyDir(src, path.join(OUT, dir));
    console.log(`  ✓  ${dir}/`);
  }
}

console.log('\n✅  Build → public/\n');
