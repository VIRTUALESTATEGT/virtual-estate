'use strict';
const express  = require('express');
const supabase = require('../config/supabase');
const { crearComisionCaptacion, crearComisionReferida, registrarCierre } = require('../services/comisiones');

const MONEDAS_VALIDAS = ['GTQ', 'USD'];
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function _isDuplicate(e) {
  return e?.code === '23505' || e?.message?.includes('duplicate') || e?.message?.includes('unique');
}

function _errorStatus(e) {
  // El servicio puede adjuntar _status directamente al error (ej. 400, 404, 409)
  if (e._status) return e._status;
  if (_isDuplicate(e)) return 409;
  const m = e?.message || '';
  if (/no encontrad[ao]/i.test(m)) return 404;
  if (/estado|no permite|debe estar|ya tiene|simultáneamente|ya está en estado/i.test(m)) return 409;
  return 500;
}

// Atomic state transition: UPDATE con .eq('estado', expectedEstado) para evitar TOCTOU.
// Si 0 filas → follow-up SELECT para distinguir 404 de 409.
async function _atomicTransition(id, expectedEstado, patch) {
  const { data, error } = await supabase
    .from('comisiones')
    .update(patch)
    .eq('id', id)
    .eq('estado', expectedEstado)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const { data: cur } = await supabase.from('comisiones').select('id, estado').eq('id', id).maybeSingle();
    if (!cur) throw Object.assign(new Error('Comisión no encontrada'), { _status: 404 });
    throw Object.assign(
      new Error(`Estado '${cur.estado}' no permite esta transición (se esperaba '${expectedEstado}')`),
      { _status: 409 }
    );
  }
  return data;
}

// ── CRM router (mounted under /api/comisiones, requires gerente+) ─────────────
const router = express.Router();

// GET /api/comisiones
router.get('/', async (req, res) => {
  try {
    const { estado, tipo, agente_id, page = 1, limit: rawLimit = 50 } = req.query;
    const limit = Math.min(Number(rawLimit), 100);
    const from  = (Number(page) - 1) * limit;
    let q = supabase
      .from('comisiones')
      .select(`
        id, tipo, estado, monto_comision, pct_comision, modo, origen_pct, moneda,
        subtotal_sin_iva, created_at, updated_at,
        agentes(id, nombre, email),
        cotizaciones(id, tipo_servicio, estado, moneda),
        cierres_propiedad(id, tipo, fecha_cierre, precio_final),
        propiedades(id, direccion),
        clientes(id, nombre, apellido)
      `)
      .order('id', { ascending: false })
      .range(from, from + limit - 1);

    if (estado)    q = q.eq('estado', estado);
    if (tipo)      q = q.eq('tipo', tipo);
    if (agente_id) q = q.eq('agente_id', Number(agente_id));

    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/comisiones/captacion  — BEFORE /:id
router.post('/captacion', async (req, res) => {
  try {
    const { cotizacion_id, agente_id } = req.body;
    if (!cotizacion_id) return res.status(400).json({ error: 'cotizacion_id es obligatorio' });
    const com = await crearComisionCaptacion({
      cotizacionId:     Number(cotizacion_id),
      agenteIdOverride: agente_id ? Number(agente_id) : null,
      usuarioId:        req.usuario.id,
    });
    res.status(201).json(com);
  } catch (e) { res.status(_errorStatus(e)).json({ error: e.message }); }
});

// POST /api/comisiones/referida  — BEFORE /:id
router.post('/referida', async (req, res) => {
  try {
    const { cotizacion_id, agente_id } = req.body;
    if (!cotizacion_id || !agente_id)
      return res.status(400).json({ error: 'cotizacion_id y agente_id son obligatorios' });
    const com = await crearComisionReferida({
      cotizacionId: Number(cotizacion_id),
      agenteId:     Number(agente_id),
      usuarioId:    req.usuario.id,
    });
    res.status(201).json(com);
  } catch (e) { res.status(_errorStatus(e)).json({ error: e.message }); }
});

// GET /api/comisiones/cierres  — BEFORE /cierres/:id and /:id
router.get('/cierres', async (req, res) => {
  try {
    const { propiedad_id, agente_id, page = 1, limit: rawLimit = 50 } = req.query;
    const limit = Math.min(Number(rawLimit), 100);
    const from  = (Number(page) - 1) * limit;
    let q = supabase
      .from('cierres_propiedad')
      .select('*, propiedades(id, direccion), agentes(id, nombre)')
      .order('id', { ascending: false })
      .range(from, from + limit - 1);
    if (propiedad_id) q = q.eq('propiedad_id', Number(propiedad_id));
    if (agente_id)    q = q.eq('agente_cierre_id', Number(agente_id));
    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/comisiones/cierres  — BEFORE /cierres/:id and /:id
router.post('/cierres', async (req, res) => {
  try {
    const {
      propiedad_id, tipo, precio_final, moneda, fecha_cierre,
      agente_cierre_id, pct_cierre_override, monto_cierre_fijo_override,
      moneda_cierre_fijo_override, comision_ve_cobrada_override, notas,
    } = req.body;

    // Campos obligatorios
    const missing = [];
    if (!propiedad_id)     missing.push('propiedad_id');
    if (!tipo)             missing.push('tipo');
    if (!precio_final)     missing.push('precio_final');
    if (!fecha_cierre)     missing.push('fecha_cierre');
    if (!agente_cierre_id) missing.push('agente_cierre_id');
    if (missing.length)    return res.status(400).json({ error: `Campos obligatorios: ${missing.join(', ')}` });

    if (!['venta', 'renta'].includes(tipo))
      return res.status(400).json({ error: "tipo debe ser 'venta' o 'renta'" });

    if (Number(precio_final) <= 0)
      return res.status(400).json({ error: 'precio_final debe ser mayor que 0' });

    if (!RE_FECHA.test(fecha_cierre))
      return res.status(400).json({ error: 'fecha_cierre debe tener formato YYYY-MM-DD' });

    const monedaNorm = (moneda || 'USD').toUpperCase();
    if (!MONEDAS_VALIDAS.includes(monedaNorm))
      return res.status(400).json({ error: `moneda debe ser uno de: ${MONEDAS_VALIDAS.join(', ')}` });

    // monto_fijo requiere moneda
    if (monto_cierre_fijo_override != null && !moneda_cierre_fijo_override)
      return res.status(400).json({ error: 'moneda_cierre_fijo_override es obligatorio cuando se especifica monto_cierre_fijo_override' });

    if (moneda_cierre_fijo_override != null) {
      const monedaFijoNorm = String(moneda_cierre_fijo_override).toUpperCase();
      if (!MONEDAS_VALIDAS.includes(monedaFijoNorm))
        return res.status(400).json({ error: `moneda_cierre_fijo_override debe ser uno de: ${MONEDAS_VALIDAS.join(', ')}` });
    }

    const result = await registrarCierre({
      propiedadId:              Number(propiedad_id),
      tipo,
      precioFinal:              Number(precio_final),
      moneda:                   monedaNorm,
      fechaCierre:              fecha_cierre,
      agenteCierreId:           Number(agente_cierre_id),
      pctCierreOverride:        pct_cierre_override        ?? null,
      montoCierreFijoOverride:  monto_cierre_fijo_override  ?? null,
      monedaCierreFijoOverride: moneda_cierre_fijo_override ? String(moneda_cierre_fijo_override).toUpperCase() : null,
      comisionVeCobradaOverride:comision_ve_cobrada_override ?? null,
      notas:                    notas || null,
      usuarioId:                req.usuario.id,
    });
    res.status(201).json(result);
  } catch (e) { res.status(_errorStatus(e)).json({ error: e.message }); }
});

// GET /api/comisiones/cierres/:id  — BEFORE /:id
router.get('/cierres/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('cierres_propiedad')
      .select('*, propiedades(id, direccion, comision_ve), agentes(id, nombre, email)')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!data)  return res.status(404).json({ error: 'Cierre no encontrado' });

    const { data: coms } = await supabase
      .from('comisiones')
      .select('id, agente_id, agentes(nombre), tipo, estado, monto_comision, pct_comision, modo, moneda, origen_pct')
      .eq('cierre_id', req.params.id);

    res.json({ ...data, comisiones: coms || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/comisiones/cierres/:id/confirmar-cobro  — BEFORE /:id
router.post('/cierres/:id/confirmar-cobro', async (req, res) => {
  try {
    const { fecha_cobro } = req.body;
    if (!fecha_cobro) return res.status(400).json({ error: 'fecha_cobro es obligatorio (YYYY-MM-DD)' });
    if (!RE_FECHA.test(fecha_cobro))
      return res.status(400).json({ error: 'fecha_cobro debe tener formato YYYY-MM-DD' });

    const { data, error } = await supabase
      .from('cierres_propiedad')
      .update({ cobro_ve_confirmado: true, fecha_cobro })
      .eq('id', req.params.id)
      .eq('cobro_ve_confirmado', false)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const { data: cur } = await supabase
        .from('cierres_propiedad').select('id, cobro_ve_confirmado').eq('id', req.params.id).maybeSingle();
      if (!cur) return res.status(404).json({ error: 'Cierre no encontrado' });
      return res.status(409).json({ error: 'El cobro ya estaba confirmado' });
    }
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/comisiones/:id
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('comisiones')
      .select(`
        *,
        agentes(id, nombre, email),
        cotizaciones(id, tipo_servicio, estado, monto, moneda, detalles_json),
        cierres_propiedad(*),
        propiedades(id, direccion, comision_ve),
        clientes(id, nombre, apellido, email)
      `)
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!data)  return res.status(404).json({ error: 'Comisión no encontrada' });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/comisiones/:id/validar  — no_validada → pendiente
router.post('/:id/validar', async (req, res) => {
  try {
    const { notas_admin } = req.body;

    // notas_admin obligatorio para captacion/referida: actúa como comprobante del pago
    // (cotizaciones no tiene registro de pago confirmado independiente)
    const { data: cur } = await supabase
      .from('comisiones').select('estado, tipo').eq('id', req.params.id).maybeSingle();
    if (!cur) return res.status(404).json({ error: 'No encontrada' });
    if (['captacion_escaneo', 'cotizacion_referida'].includes(cur.tipo) && !notas_admin)
      return res.status(400).json({ error: 'notas_admin es obligatorio al validar captacion_escaneo y cotizacion_referida (indica el comprobante de pago de la cotización)' });

    const data = await _atomicTransition(req.params.id, 'no_validada', {
      estado:       'pendiente',
      validada_por: req.usuario.id,
      validada_at:  new Date().toISOString(),
      notas_admin:  notas_admin || null,
      updated_at:   new Date().toISOString(),
    });
    res.json(data);
  } catch (e) { res.status(e._status || 500).json({ error: e.message }); }
});

// POST /api/comisiones/:id/por-pagar  — pendiente → por_pagar
router.post('/:id/por-pagar', async (req, res) => {
  try {
    // Para cierre_propiedad: verificar cobro_ve_confirmado=true antes de avanzar
    const { data: cur } = await supabase
      .from('comisiones').select('estado, tipo, cierre_id').eq('id', req.params.id).maybeSingle();
    if (!cur) return res.status(404).json({ error: 'No encontrada' });

    if (cur.tipo === 'cierre_propiedad' && cur.cierre_id) {
      const { data: cierre } = await supabase
        .from('cierres_propiedad').select('cobro_ve_confirmado').eq('id', cur.cierre_id).maybeSingle();
      if (!cierre?.cobro_ve_confirmado)
        return res.status(409).json({ error: 'El cobro de VE no ha sido confirmado. Usa POST /cierres/:id/confirmar-cobro primero.' });
    }

    const data = await _atomicTransition(req.params.id, 'pendiente', {
      estado:     'por_pagar',
      updated_at: new Date().toISOString(),
    });
    res.json(data);
  } catch (e) { res.status(e._status || 500).json({ error: e.message }); }
});

// POST /api/comisiones/:id/pagar  — por_pagar → pagada
router.post('/:id/pagar', async (req, res) => {
  try {
    const { metodo_pago, referencia_pago } = req.body;
    if (!metodo_pago || !referencia_pago)
      return res.status(400).json({ error: 'metodo_pago y referencia_pago son obligatorios' });

    // Para cierre_propiedad: verificar cobro_ve_confirmado=true
    const { data: cur } = await supabase
      .from('comisiones').select('estado, tipo, cierre_id').eq('id', req.params.id).maybeSingle();
    if (!cur) return res.status(404).json({ error: 'No encontrada' });

    if (cur.tipo === 'cierre_propiedad' && cur.cierre_id) {
      const { data: cierre } = await supabase
        .from('cierres_propiedad').select('cobro_ve_confirmado').eq('id', cur.cierre_id).maybeSingle();
      if (!cierre?.cobro_ve_confirmado)
        return res.status(409).json({ error: 'El cobro de VE no ha sido confirmado. Usa POST /cierres/:id/confirmar-cobro primero.' });
    }

    const data = await _atomicTransition(req.params.id, 'por_pagar', {
      estado:          'pagada',
      pagada_at:       new Date().toISOString(),
      metodo_pago,
      referencia_pago,
      pagada_por:      req.usuario.id,
      updated_at:      new Date().toISOString(),
    });
    res.json(data);
  } catch (e) { res.status(e._status || 500).json({ error: e.message }); }
});

// POST /api/comisiones/:id/rechazar  — any → rechazada (excepto pagada/rechazada)
// Atómico: el UPDATE condiciona a que estado no sea pagada ni rechazada.
router.post('/:id/rechazar', async (req, res) => {
  try {
    const { notas_admin } = req.body;
    if (!notas_admin) return res.status(400).json({ error: 'notas_admin es obligatorio para rechazar' });

    const { data, error } = await supabase
      .from('comisiones')
      .update({ estado: 'rechazada', notas_admin, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .neq('estado', 'pagada')
      .neq('estado', 'rechazada')
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      // 0 filas: distinguir 404 de 409
      const { data: cur } = await supabase
        .from('comisiones').select('id, estado').eq('id', req.params.id).maybeSingle();
      if (!cur) return res.status(404).json({ error: 'No encontrada' });
      if (cur.estado === 'pagada')    return res.status(409).json({ error: 'No se puede rechazar una comisión ya pagada' });
      if (cur.estado === 'rechazada') return res.status(409).json({ error: 'Ya está rechazada' });
      return res.status(409).json({ error: `Estado '${cur.estado}' no permite rechazar` });
    }
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/comisiones/:id/revertir  — pagada → pendiente
router.post('/:id/revertir', async (req, res) => {
  try {
    const { nota_reversion } = req.body;
    if (!nota_reversion) return res.status(400).json({ error: 'nota_reversion es obligatorio' });

    // Leer campos de pago antes de limpiarlos para preservarlos en nota_reversion
    const { data: cur } = await supabase
      .from('comisiones')
      .select('estado, pagada_at, metodo_pago, referencia_pago, pagada_por')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!cur) return res.status(404).json({ error: 'No encontrada' });
    if (cur.estado !== 'pagada')
      return res.status(409).json({ error: `Solo se puede revertir desde 'pagada' (estado actual: ${cur.estado})` });

    const notaConHistorial = [
      nota_reversion,
      `--- Pago revertido: método=${cur.metodo_pago}, ref=${cur.referencia_pago}, pagada_at=${cur.pagada_at}, pagada_por_id=${cur.pagada_por}`,
    ].join('\n');

    const data = await _atomicTransition(req.params.id, 'pagada', {
      estado:          'pendiente',
      revertida_por:   req.usuario.id,
      revertida_at:    new Date().toISOString(),
      nota_reversion:  notaConHistorial,
      // chk_pago_completo: todos null juntos
      pagada_at:       null,
      metodo_pago:     null,
      referencia_pago: null,
      pagada_por:      null,
      updated_at:      new Date().toISOString(),
    });
    res.json(data);
  } catch (e) { res.status(e._status || 500).json({ error: e.message }); }
});

// ── Portal router (mounted under /api/mis-comisiones, solo role=cliente) ──────
// Solo lectura. El agente ve únicamente sus propias comisiones.
// Campos internos omitidos: notas_admin, validada_por, pagada_por, revertida_por,
//   declarada_agente, declarada_cliente, subtotal_sin_iva, precio_final, comision_ve_cobrada.
//
// Lookup: agentes.usuario_id = req.usuario.id (FK directa, migration 087).
// Si el agente no tiene usuario_id configurado, el portal devuelve 404.

const portalRouter = express.Router();

async function _getAgenteByUsuarioId(usuarioId) {
  const { data } = await supabase
    .from('agentes')
    .select('id, nombre')
    .eq('usuario_id', usuarioId)
    .maybeSingle();
  return data ?? null;
}

// GET /api/mis-comisiones
portalRouter.get('/', async (req, res) => {
  try {
    const agente = await _getAgenteByUsuarioId(req.usuario.id);
    if (!agente) return res.status(404).json({ error: 'No tenés un perfil de agente asociado a esta cuenta.' });

    const { estado, tipo, page = 1, limit: rawLimit = 25 } = req.query;
    const limit = Math.min(Number(rawLimit), 100);
    const from  = (Number(page) - 1) * limit;
    let q = supabase
      .from('comisiones')
      .select(`
        id, tipo, estado, monto_comision, pct_comision, modo, moneda, origen_pct, created_at,
        cotizaciones(id, tipo_servicio, estado),
        cierres_propiedad(id, tipo, fecha_cierre),
        propiedades(id, direccion)
      `)
      .eq('agente_id', agente.id)
      .order('id', { ascending: false })
      .range(from, from + limit - 1);

    if (estado) q = q.eq('estado', estado);
    if (tipo)   q = q.eq('tipo', tipo);

    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/mis-comisiones/:id
portalRouter.get('/:id', async (req, res) => {
  try {
    const agente = await _getAgenteByUsuarioId(req.usuario.id);
    if (!agente) return res.status(404).json({ error: 'No tenés un perfil de agente asociado a esta cuenta.' });

    const { data, error } = await supabase
      .from('comisiones')
      .select(`
        id, tipo, estado, monto_comision, pct_comision, modo, moneda, origen_pct,
        created_at, updated_at,
        cotizaciones(id, tipo_servicio, estado),
        cierres_propiedad(id, tipo, fecha_cierre, moneda),
        propiedades(id, direccion)
      `)
      .eq('id', req.params.id)
      .eq('agente_id', agente.id)
      .maybeSingle();
    if (error) throw error;
    if (!data)  return res.status(404).json({ error: 'Comisión no encontrada' });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router, portalRouter };
