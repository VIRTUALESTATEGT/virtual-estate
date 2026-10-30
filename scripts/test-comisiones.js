/**
 * scripts/test-comisiones.js
 *
 * Pruebas de integración del módulo de comisiones contra la base de datos real.
 * ESCRIBE en la base de datos (inserta filas de prueba) y las elimina al final.
 * Ejecutar con cuidado en producción — prefiere un entorno de staging.
 *
 * Requiere .env con SUPABASE_URL y SUPABASE_SECRET_KEY.
 *
 * Uso:
 *   node scripts/test-comisiones.js
 *
 * Para pruebas puras (sin DB):
 *   node scripts/test-comisiones-puras.js
 *
 * Qué valida:
 *   1. crearComisionCaptacion con cotización real en estado 'confirmada'
 *   2. crearComisionCierre (registrarCierre) con propiedad y agente reales
 *   3. Intento de duplicado → error esperado
 *   4. cotización no confirmada → error esperado
 *   5. Cleanup de todas las filas insertadas
 */

'use strict';
require('dotenv').config();

const supabase = require('../src/config/supabase');
const { crearComisionCaptacion, registrarCierre } = require('../src/services/comisiones');

const inserted = { comisiones: [], cierres: [] };
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

async function cleanup() {
  console.log('\n[Cleanup]');
  if (inserted.comisiones.length) {
    const { error } = await supabase.from('comisiones').delete().in('id', inserted.comisiones);
    ok(`eliminadas ${inserted.comisiones.length} comisión(es)`, !error, error?.message);
  }
  if (inserted.cierres.length) {
    const { error } = await supabase.from('cierres_propiedad').delete().in('id', inserted.cierres);
    ok(`eliminados ${inserted.cierres.length} cierre(s)`, !error, error?.message);
  }
}

async function main() {
  // ── Buscar datos semilla ──────────────────────────────────────────────────

  console.log('\n[Setup] Buscando datos semilla en la DB...');

  // Cotización en 'confirmada' con propiedad_id y detalles_json.subtotal
  const { data: cotsRaw } = await supabase
    .from('cotizaciones')
    .select('id, estado, propiedad_id, pct_agente, cliente_id, moneda, detalles_json')
    .eq('estado', 'confirmada')
    .not('propiedad_id', 'is', null)
    .limit(5);

  // filtrar las que tengan detalles_json.subtotal
  const cotConSubtotal = (cotsRaw || []).find(c => {
    try {
      const dj = typeof c.detalles_json === 'string' ? JSON.parse(c.detalles_json) : (c.detalles_json || {});
      return dj.subtotal != null;
    } catch { return false; }
  }) ?? null;

  const { data: agentesRaw } = await supabase.from('agentes').select('id, nombre, comision').limit(1);
  const agente = agentesRaw?.[0] ?? null;

  // Propiedad con agente_responsable_id y comision_ve para poder registrar cierre
  const { data: propsRaw } = await supabase
    .from('propiedades')
    .select('id, direccion, comision_ve, agente_responsable_id')
    .not('agente_responsable_id', 'is', null)
    .not('comision_ve', 'is', null)
    .limit(5);
  // Filtrar propiedades que no tengan cierre ya registrado
  let propiedadSinCierre = null;
  for (const p of (propsRaw || [])) {
    const { data: c } = await supabase
      .from('cierres_propiedad').select('id').eq('propiedad_id', p.id).maybeSingle();
    if (!c) { propiedadSinCierre = p; break; }
  }

  console.log(`  cotización confirmada con subtotal: ${cotConSubtotal ? `#${cotConSubtotal.id}` : 'ninguna'}`);
  console.log(`  agente:    ${agente ? `#${agente.id} ${agente.nombre}` : 'ninguno'}`);
  console.log(`  propiedad sin cierre: ${propiedadSinCierre ? `#${propiedadSinCierre.id}` : 'ninguna'}`);

  try {
    // ── 1. crearComisionCaptacion ───────────────────────────────────────────

    console.log('\n[1] crearComisionCaptacion');

    if (cotConSubtotal && agente) {
      try {
        const com = await crearComisionCaptacion({
          cotizacionId:     cotConSubtotal.id,
          agenteIdOverride: agente.id,
          usuarioId:        1,
        });
        inserted.comisiones.push(com.id);
        ok(`inserción exitosa → id=${com.id}`, !!com.id);
        ok('tipo correcto', com.tipo === 'captacion_escaneo');
        ok('estado no_validada', com.estado === 'no_validada');
        ok('monto_comision >= 0', typeof com.monto_comision === 'number' && com.monto_comision >= 0);
        ok('moneda presente', !!com.moneda);
        ok('modo presente', ['porcentaje', 'monto_fijo'].includes(com.modo));
        ok('origen_pct presente', ['cotizacion', 'propiedad', 'agente', 'global'].includes(com.origen_pct));

        // ── 2. Duplicado → error esperado ────────────────────────────────────
        console.log('\n[2] Duplicado → error esperado');
        try {
          await crearComisionCaptacion({ cotizacionId: cotConSubtotal.id, agenteIdOverride: agente.id, usuarioId: 1 });
          ok('debería haber tirado error de duplicado', false, 'no tiró error');
        } catch (dupE) {
          ok('duplicate key rechazado', dupE.code === '23505' || /duplicate|unique/i.test(dupE.message));
        }
      } catch (e) { err('crearComisionCaptacion', e); }
    } else {
      console.log('  SKIP: no hay cotización confirmada con propiedad y detalles_json.subtotal');
    }

    // ── 3. registrarCierre ────────────────────────────────────────────────

    console.log('\n[3] registrarCierre');

    if (propiedadSinCierre && agente) {
      try {
        const result = await registrarCierre({
          propiedadId:    propiedadSinCierre.id,
          tipo:           'venta',
          precioFinal:    100000,
          moneda:         'USD',
          fechaCierre:    new Date().toISOString().slice(0, 10),
          agenteCierreId: agente.id,
          notas:          'TEST — eliminar',
          usuarioId:      1,
        });
        inserted.cierres.push(result.cierre.id);
        inserted.comisiones.push(result.comision.id);

        ok('cierre creado', !!result.cierre?.id);
        ok('comisión de cierre creada', !!result.comision?.id);
        ok('tipo cierre_propiedad', result.comision.tipo === 'cierre_propiedad');
        ok('cierre_id linkado', result.comision.cierre_id === result.cierre.id);
        ok('comision_ve_cobrada >= 0', result.cierre.comision_ve_cobrada >= 0);
        ok('monto_comision >= 0', result.comision.monto_comision >= 0);
        ok('moneda consistente', result.cierre.moneda === result.comision.moneda);
      } catch (e) { err('registrarCierre', e); }
    } else {
      console.log('  SKIP: no hay propiedad con agente_responsable_id, comision_ve y sin cierre previo');
    }

    // ── 4. cotización no confirmada → error ──────────────────────────────

    console.log('\n[4] cotización no confirmada → error esperado');

    const { data: borr } = await supabase
      .from('cotizaciones').select('id, estado').eq('estado', 'borrador').limit(1);
    if (borr?.[0] && agente) {
      try {
        await crearComisionCaptacion({ cotizacionId: borr[0].id, agenteIdOverride: agente.id, usuarioId: 1 });
        ok('debería haber tirado error de estado', false, 'no tiró error');
      } catch (e) {
        ok('estado inválido rechazado', /confirmada|estado/i.test(e.message));
      }
    } else {
      console.log('  SKIP: no hay cotización en borrador');
    }

  } finally {
    await cleanup();
    console.log(`\n── Resultado: ${passed} ok / ${failed} fallidos ─────────────\n`);
    process.exit(failed > 0 ? 1 : 0);
  }
}

main().catch(e => {
  console.error('\nError fatal:', e.message);
  cleanup().finally(() => process.exit(1));
});
