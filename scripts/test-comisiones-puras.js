/**
 * scripts/test-comisiones-puras.js
 *
 * Pruebas de funciones puras: resolverPct y calcularMonto.
 * No requiere DB ni variables de entorno.
 *
 * Uso:
 *   node scripts/test-comisiones-puras.js
 */

'use strict';

const { resolverPct, calcularMonto } = require('../src/services/comisiones');

let passed = 0;
let failed = 0;

function ok(label, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else       { console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}

function err(label, e) {
  console.error(`  ✗ ${label}: ${e?.message || e}`);
  failed++;
}

// ── resolverPct ───────────────────────────────────────────────────────────────

console.log('\n[1] resolverPct — captacion_escaneo / cotizacion_referida');

try {
  const r = resolverPct({ tipo: 'captacion_escaneo', cotPctAgente: 12 });
  ok('cotPctAgente wins over propiedad/agente/global', r.pct === 12 && r.origen_pct === 'cotizacion');
} catch (e) { err('cotPctAgente', e); }

try {
  const r = resolverPct({ tipo: 'captacion_escaneo', propPctCaptador: 8, agentePct: 5, globalPct: 3 });
  ok('propPctCaptador wins over agente/global', r.pct === 8 && r.origen_pct === 'propiedad');
} catch (e) { err('propPctCaptador', e); }

try {
  const r = resolverPct({ tipo: 'captacion_escaneo', agentePct: 7, globalPct: 3 });
  ok('agentePct wins over global', r.pct === 7 && r.origen_pct === 'agente');
} catch (e) { err('agentePct', e); }

try {
  const r = resolverPct({ tipo: 'captacion_escaneo', globalPct: 4 });
  ok('global fallback', r.pct === 4 && r.origen_pct === 'global');
} catch (e) { err('global fallback', e); }

try {
  resolverPct({ tipo: 'captacion_escaneo' });
  ok('throws when no rate', false, 'should have thrown');
} catch (e) {
  ok('throws when no rate', e.message.includes('no se pudo resolver'));
}

try {
  const r = resolverPct({ tipo: 'cotizacion_referida', cotPctAgente: 10, agentePct: 5 });
  ok('cotizacion_referida: cotPctAgente wins', r.pct === 10 && r.origen_pct === 'cotizacion');
} catch (e) { err('cotizacion_referida cotPctAgente', e); }

console.log('\n[2] resolverPct — cierre_propiedad');

try {
  const r = resolverPct({ tipo: 'cierre_propiedad', cierrePctOverride: 15, propPctCierre: 5 });
  ok('cierrePctOverride wins for cierre', r.pct === 15 && r.origen_pct === 'cierre');
} catch (e) { err('cierrePctOverride', e); }

try {
  const r = resolverPct({ tipo: 'cierre_propiedad', cierreMontoFijo: 500, cierreMonedaFijo: 'USD', propPctCierre: 5 });
  ok('cierreMontoFijo wins over propPctCierre', r.modo === 'monto_fijo' && r.montoFijo === 500 && r.origen_pct === 'cierre');
} catch (e) { err('cierreMontoFijo', e); }

try {
  const r = resolverPct({ tipo: 'cierre_propiedad', propMontoCierreFijo: 200, propMonedaCierreFijo: 'GTQ', agentePct: 8 });
  ok('propMontoCierreFijo wins over agentePct', r.modo === 'monto_fijo' && r.montoFijo === 200 && r.origen_pct === 'propiedad');
} catch (e) { err('propMontoCierreFijo', e); }

try {
  const r = resolverPct({ tipo: 'cierre_propiedad', agentePct: 6, globalPct: 3 });
  ok('agentePct wins over global for cierre', r.pct === 6 && r.origen_pct === 'agente');
} catch (e) { err('cierre agentePct', e); }

try {
  resolverPct({ tipo: 'cierre_propiedad' });
  ok('throws when no rate for cierre', false, 'should have thrown');
} catch (e) {
  ok('throws when no rate for cierre', e.message.includes('no se pudo resolver'));
}

// ── calcularMonto ─────────────────────────────────────────────────────────────

console.log('\n[3] calcularMonto');

ok('porcentaje: 1000 * 10% = 100',   calcularMonto({ modo: 'porcentaje', pct: 10, base: 1000 }) === 100);
ok('porcentaje: 333 * 5% = 16.65',   calcularMonto({ modo: 'porcentaje', pct: 5, base: 333 }) === 16.65);
ok('monto_fijo: returns fixed value', calcularMonto({ modo: 'monto_fijo', montoFijo: 250.5, base: 9999 }) === 250.5);
ok('rounding: 0.1 + 0.2 scenario',   calcularMonto({ modo: 'porcentaje', pct: 10, base: 0.3 }) === 0.03);
ok('porcentaje: 0 base → 0',          calcularMonto({ modo: 'porcentaje', pct: 10, base: 0 }) === 0);

try {
  calcularMonto({ modo: 'desconocido', pct: 5, base: 100 });
  ok('throws on unknown modo', false, 'should have thrown');
} catch (e) {
  ok('throws on unknown modo', e.message.includes('modo desconocido'));
}

// ── Resultado ─────────────────────────────────────────────────────────────────

console.log(`\n── Resultado: ${passed} ok / ${failed} fallidos ─────────────\n`);
process.exit(failed > 0 ? 1 : 0);
