'use strict';
const supabase = require('../config/supabase');

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Resolve the commission rate from the priority cascade.
 * Returns { modo, pct, montoFijo, monedaFijo, origen_pct }.
 * Throws if no rate is resolvable.
 *
 * captacion_escaneo / cotizacion_referida priority:
 *   cotPctAgente > propPctCaptador > agentePct > globalPct
 *
 * cierre_propiedad priority:
 *   cierrePctOverride|cierreMontoFijo > propPctCierre|propMontoCierreFijo > agentePct > globalPct
 */
function resolverPct({
  tipo,
  cotPctAgente         = null,
  cierrePctOverride    = null,
  cierreMontoFijo      = null,
  cierreMonedaFijo     = null,
  propPctCaptador      = null,
  propPctCierre        = null,
  propMontoCierreFijo  = null,
  propMonedaCierreFijo = null,
  agentePct            = null,
  globalPct            = null,
}) {
  const pct  = (v, origen) => ({ modo: 'porcentaje', pct: Number(v), montoFijo: null, monedaFijo: null, origen_pct: origen });
  const fijo = (m, mon, origen) => ({ modo: 'monto_fijo', pct: null, montoFijo: Number(m), monedaFijo: mon, origen_pct: origen });

  if (tipo === 'captacion_escaneo' || tipo === 'cotizacion_referida') {
    if (cotPctAgente    != null) return pct(cotPctAgente,    'cotizacion');
    if (propPctCaptador != null) return pct(propPctCaptador, 'propiedad');
    if (agentePct       != null) return pct(agentePct,       'agente');
    if (globalPct       != null) return pct(globalPct,       'global');
  } else if (tipo === 'cierre_propiedad') {
    if (cierrePctOverride   != null) return pct(cierrePctOverride, 'cierre');
    if (cierreMontoFijo     != null) return fijo(cierreMontoFijo, cierreMonedaFijo, 'cierre');
    if (propPctCierre       != null) return pct(propPctCierre, 'propiedad');
    if (propMontoCierreFijo != null) return fijo(propMontoCierreFijo, propMonedaCierreFijo, 'propiedad');
    if (agentePct           != null) return pct(agentePct, 'agente');
    if (globalPct           != null) return pct(globalPct, 'global');
  }

  throw new Error(`resolverPct: no se pudo resolver el porcentaje para tipo=${tipo}`);
}

/**
 * Calculate monto_comision from a resolved rate and a base amount.
 * Returns a number rounded to 2 decimal places.
 */
function calcularMonto({ modo, pct, montoFijo, base }) {
  if (modo === 'porcentaje') return Math.round(Number(base) * Number(pct) / 100 * 100) / 100;
  if (modo === 'monto_fijo') return Math.round(Number(montoFijo) * 100) / 100;
  throw new Error(`calcularMonto: modo desconocido=${modo}`);
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function _getGlobalPct() {
  const { data } = await supabase
    .from('config_sitio')
    .select('valor')
    .eq('clave', 'comision_global_pct')
    .maybeSingle();
  return data?.valor != null ? Number(data.valor) : null;
}

// Returns the subtotal sin IVA from detalles_json.subtotal.
// Throws if absent or <= 0.
function _extractSubtotal(cot) {
  const dj = typeof cot.detalles_json === 'string'
    ? (() => { try { return JSON.parse(cot.detalles_json); } catch { return {}; } })()
    : (cot.detalles_json || {});
  if (dj.subtotal == null)
    throw new Error(`Cotización ${cot.id}: detalles_json.subtotal no encontrado. La comisión no puede calcularse sin el subtotal sin IVA.`);
  const subtotal = Number(dj.subtotal);
  if (subtotal <= 0)
    throw new Error(`Cotización ${cot.id}: detalles_json.subtotal es ${dj.subtotal}, debe ser > 0.`);
  return subtotal;
}

// Returns the correct moneda for a commission.
// When modo=monto_fijo the commission currency is resolved.monedaFijo,
// which may differ from the closing/quotation currency.
function _resolvedMoneda(resolved, fallbackMoneda) {
  return resolved.modo === 'monto_fijo' && resolved.monedaFijo
    ? resolved.monedaFijo
    : (fallbackMoneda || 'USD');
}

// ── captacion_escaneo ─────────────────────────────────────────────────────────

/**
 * Creates a captacion_escaneo commission for the captador of the property
 * linked to a confirmed cotización.
 *
 * agenteIdOverride: explicit agent; falls back to propiedad.agente_responsable_id.
 * Trigger state: 'confirmada' only.
 * Requires: cotización must have propiedad_id set.
 */
async function crearComisionCaptacion({ cotizacionId, agenteIdOverride = null, usuarioId }) {
  const { data: cot, error: cotErr } = await supabase
    .from('cotizaciones')
    .select('id, estado, cliente_id, moneda, detalles_json, pct_agente, propiedad_id')
    .eq('id', cotizacionId)
    .maybeSingle();
  if (cotErr) throw cotErr;
  if (!cot)   throw new Error(`Cotización ${cotizacionId} no encontrada`);
  if (cot.estado !== 'confirmada')
    throw new Error(`La cotización debe estar en 'confirmada' (estado actual: ${cot.estado})`);

  // propiedad_id es obligatorio: sin él no hay captador que resolver
  if (!cot.propiedad_id)
    throw Object.assign(
      new Error(`La cotización ${cotizacionId} no tiene una propiedad vinculada (propiedad_id es null). La comisión de captación requiere que la cotización esté asociada a una propiedad.`),
      { _status: 400 }
    );

  const { data: prop } = await supabase
    .from('propiedades')
    .select('id, agente_responsable_id, pct_captador')
    .eq('id', cot.propiedad_id)
    .maybeSingle();

  const agenteId = agenteIdOverride ?? prop?.agente_responsable_id ?? null;
  if (!agenteId)
    throw new Error('No se pudo determinar el agente captador. Pasa agente_id o vincula un agente responsable a la propiedad.');

  const { data: agente } = await supabase
    .from('agentes')
    .select('id, comision')
    .eq('id', agenteId)
    .maybeSingle();
  if (!agente) throw new Error(`Agente ${agenteId} no encontrado`);

  const globalPct      = await _getGlobalPct();
  const subtotalSinIva = _extractSubtotal(cot);

  const resolved = resolverPct({
    tipo:            'captacion_escaneo',
    cotPctAgente:    cot.pct_agente,
    propPctCaptador: prop?.pct_captador ?? null,
    agentePct:       agente.comision,
    globalPct,
  });

  const monto = calcularMonto({ ...resolved, base: subtotalSinIva });

  const { data: com, error: comErr } = await supabase
    .from('comisiones')
    .insert([{
      agente_id:        agenteId,
      cotizacion_id:    cotizacionId,
      propiedad_id:     cot.propiedad_id,
      cliente_id:       cot.cliente_id ?? null,
      tipo:             'captacion_escaneo',
      subtotal_sin_iva: subtotalSinIva,
      pct_comision:     resolved.pct,
      monto_comision:   monto,
      moneda:           _resolvedMoneda(resolved, cot.moneda),
      modo:             resolved.modo,
      origen_pct:       resolved.origen_pct,
      estado:           'no_validada',
    }])
    .select()
    .single();
  if (comErr) throw comErr;
  return com;
}

// ── cotizacion_referida ───────────────────────────────────────────────────────

/**
 * Creates a cotizacion_referida commission for an agent who referred the client.
 * Same pct cascade as captacion but without propPctCaptador.
 * Trigger state: 'confirmada' only.
 */
async function crearComisionReferida({ cotizacionId, agenteId, usuarioId }) {
  const { data: cot, error: cotErr } = await supabase
    .from('cotizaciones')
    .select('id, estado, cliente_id, moneda, detalles_json, pct_agente, propiedad_id')
    .eq('id', cotizacionId)
    .maybeSingle();
  if (cotErr) throw cotErr;
  if (!cot)   throw new Error(`Cotización ${cotizacionId} no encontrada`);
  if (cot.estado !== 'confirmada')
    throw new Error(`La cotización debe estar en 'confirmada' (estado actual: ${cot.estado})`);

  const { data: agente } = await supabase
    .from('agentes').select('id, comision').eq('id', agenteId).maybeSingle();
  if (!agente) throw new Error(`Agente ${agenteId} no encontrado`);

  const globalPct      = await _getGlobalPct();
  const subtotalSinIva = _extractSubtotal(cot);

  const resolved = resolverPct({
    tipo:         'cotizacion_referida',
    cotPctAgente:  cot.pct_agente,
    agentePct:     agente.comision,
    globalPct,
  });
  const monto = calcularMonto({ ...resolved, base: subtotalSinIva });

  const { data: com, error: comErr } = await supabase
    .from('comisiones')
    .insert([{
      agente_id:        agenteId,
      cotizacion_id:    cotizacionId,
      propiedad_id:     cot.propiedad_id ?? null,
      cliente_id:       cot.cliente_id   ?? null,
      tipo:             'cotizacion_referida',
      subtotal_sin_iva: subtotalSinIva,
      pct_comision:     resolved.pct,
      monto_comision:   monto,
      moneda:           _resolvedMoneda(resolved, cot.moneda),
      modo:             resolved.modo,
      origen_pct:       resolved.origen_pct,
      estado:           'no_validada',
    }])
    .select()
    .single();
  if (comErr) throw comErr;
  return com;
}

// ── cierre_propiedad ──────────────────────────────────────────────────────────

/**
 * Registers a property closing via an atomic PostgreSQL RPC (migration 086).
 * Pre-validates before calling the RPC; the RPC repeats critical checks atomically.
 *
 * Moneda de la comisión: resolved.monedaFijo cuando modo=monto_fijo, de lo contrario
 * la moneda del cierre. Si coinciden, la comisión del agente no puede exceder comision_ve_cobrada.
 */
async function registrarCierre({
  propiedadId,
  tipo,
  precioFinal,
  moneda                   = 'USD',
  fechaCierre,
  agenteCierreId,
  pctCierreOverride        = null,
  montoCierreFijoOverride  = null,
  monedaCierreFijoOverride = null,
  comisionVeCobradaOverride = null,
  notas                    = null,
  usuarioId,
}) {
  // Solo un tipo de override a la vez
  if (pctCierreOverride != null && montoCierreFijoOverride != null)
    throw Object.assign(
      new Error('No se pueden especificar pct_cierre_override y monto_cierre_fijo_override simultáneamente.'),
      { _status: 400 }
    );

  const { data: prop, error: propErr } = await supabase
    .from('propiedades')
    .select('id, comision_ve, pct_cierre, monto_cierre_fijo, moneda_cierre_fijo, estado_publicacion')
    .eq('id', propiedadId)
    .maybeSingle();
  if (propErr) throw propErr;
  if (!prop)   throw new Error(`Propiedad ${propiedadId} no encontrada`);

  // Pre-check: la RPC repite este chequeo atómicamente, pero fallar aquí da un mensaje más claro
  if (['vendida', 'rentada'].includes(prop.estado_publicacion))
    throw new Error(`La propiedad ${propiedadId} ya está en estado '${prop.estado_publicacion}' y no puede tener un nuevo cierre.`);

  const { data: agente } = await supabase
    .from('agentes').select('id, comision').eq('id', agenteCierreId).maybeSingle();
  if (!agente) throw new Error(`Agente ${agenteCierreId} no encontrado`);

  // Calcular comision_ve_cobrada
  let comisionVe;
  if (comisionVeCobradaOverride != null) {
    comisionVe = Math.round(Number(comisionVeCobradaOverride) * 100) / 100;
  } else if (tipo === 'venta') {
    if (prop.comision_ve == null)
      throw Object.assign(
        new Error(`La propiedad ${propiedadId} no tiene comision_ve configurada. Pasa comision_ve_cobrada_override.`),
        { _status: 400 }
      );
    comisionVe = Math.round(Number(precioFinal) * Number(prop.comision_ve) / 100 * 100) / 100;
  } else {
    // renta: primer mes completo
    comisionVe = Math.round(Number(precioFinal) * 100) / 100;
  }

  const globalPct = await _getGlobalPct();
  const resolved  = resolverPct({
    tipo:                'cierre_propiedad',
    cierrePctOverride:   pctCierreOverride,
    cierreMontoFijo:     montoCierreFijoOverride,
    cierreMonedaFijo:    monedaCierreFijoOverride,
    propPctCierre:       prop.pct_cierre,
    propMontoCierreFijo: prop.monto_cierre_fijo,
    propMonedaCierreFijo:prop.moneda_cierre_fijo,
    agentePct:           agente.comision,
    globalPct,
  });
  const monto = calcularMonto({ ...resolved, base: comisionVe });

  // Moneda de la comisión: puede diferir de la moneda del cierre en modo monto_fijo
  const monedaComision = _resolvedMoneda(resolved, moneda);

  // Si ambas monedas son iguales, la comisión del agente no puede exceder la VE
  if (monedaComision === moneda && monto > comisionVe)
    throw Object.assign(
      new Error(`La comisión del agente (${monto} ${monedaComision}) no puede exceder la comisión VE cobrada (${comisionVe} ${moneda}).`),
      { _status: 400 }
    );

  // Atomic RPC: inserts cierres_propiedad + comisiones + updates propiedades.estado_publicacion
  const { data, error: rpcErr } = await supabase.rpc('rpc_registrar_cierre', {
    p_propiedad_id:                propiedadId,
    p_tipo:                        tipo,
    p_precio_final:                Number(precioFinal),
    p_moneda:                      moneda,
    p_fecha_cierre:                fechaCierre,
    p_agente_cierre_id:            agenteCierreId,
    p_pct_cierre_override:         pctCierreOverride,
    p_monto_cierre_fijo_override:  montoCierreFijoOverride,
    p_moneda_cierre_fijo_override: monedaCierreFijoOverride,
    p_comision_ve_cobrada:         comisionVe,
    p_notas:                       notas,
    p_agente_id_comision:          agenteCierreId,
    p_pct_comision:                resolved.pct,
    p_monto_comision:              monto,
    p_moneda_comision:             monedaComision,
    p_modo:                        resolved.modo,
    p_origen_pct:                  resolved.origen_pct,
  });
  if (rpcErr) throw rpcErr;

  return { cierre: data.cierre, comision: data.comision };
}

module.exports = {
  resolverPct,
  calcularMonto,
  crearComisionCaptacion,
  crearComisionReferida,
  registrarCierre,
};
