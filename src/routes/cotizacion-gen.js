const express  = require('express');
const router   = express.Router();
const supabase = require('../config/supabase');
const { notifyAdmin, sendWhatsAppMessage } = require('../utils/whatsapp');
const { TASA_GTQ } = require('../config/constants');

// Fallback pricing (used if DB table doesn't exist yet)
const PRICING_FALLBACK = {
  'escaneo_3d':  { base: 150, per_m2: 0.8,  min: 150  },
  'as_built':    { base: 400, per_m2: 1.2,  min: 400  },
  'real_estate': { base: 200, per_m2: 0.5,  min: 200  },
  'construccion':{ base: 300, per_m2: 0.9,  min: 300  },
};

async function calcularMonto(tipo_servicio, m2 = 0) {
  try {
    const { data, error } = await supabase
      .from('precios_servicios')
      .select('precio_base, precio_por_m2, precio_minimo')
      .eq('codigo', tipo_servicio)
      .eq('activo', true)
      .maybeSingle();
    if (!error && data) {
      return Math.max(data.precio_minimo, Math.round(data.precio_base + (data.precio_por_m2 * Number(m2))));
    }
  } catch {}
  // Fallback to hardcoded
  const p = PRICING_FALLBACK[tipo_servicio];
  if (!p) return null;
  return Math.max(p.min, Math.round(p.base + (p.per_m2 * Number(m2))));
}

// GET /api/cotizacion/precios — public: list all active services + prices
router.get('/precios', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('precios_servicios')
      .select('*')
      .order('orden', { nullsFirst: false })
      .order('id');
    if (error) throw error;
    res.json(data);
  } catch {
    // Table may not exist yet — return fallback list
    res.json(Object.entries(PRICING_FALLBACK).map(([codigo, p], i) => ({
      id: i + 1, codigo, categoria: 'General',
      servicio: codigo.replace(/_/g, ' ').toUpperCase(),
      descripcion: '', tipo_precio: 'por_m2',
      precio_por_m2: p.per_m2, precio_minimo: p.min, activo: true
    })));
  }
});

// PUT /api/cotizacion/precios/:id — admin: update a service
router.put('/precios/:id', async (req, res) => {
  try {
    const {
      codigo, categoria, servicio, descripcion, tipo_precio,
      precio_fijo, precio_por_m2, rango_m2_min, rango_m2_max,
      precio_en_rango, precio_minimo, notas, activo, orden
    } = req.body;
    const update = {
      updated_at: new Date().toISOString(),
    };
    if (codigo      !== undefined) update.codigo       = codigo;
    if (categoria   !== undefined) update.categoria    = categoria;
    if (servicio    !== undefined) update.servicio      = servicio;
    if (descripcion !== undefined) update.descripcion  = descripcion;
    if (tipo_precio !== undefined) update.tipo_precio  = tipo_precio;
    if (precio_fijo       !== undefined) update.precio_fijo       = precio_fijo ? Number(precio_fijo) : null;
    if (precio_por_m2     !== undefined) update.precio_por_m2     = precio_por_m2 ? Number(precio_por_m2) : null;
    if (rango_m2_min      !== undefined) update.rango_m2_min      = rango_m2_min ? Number(rango_m2_min) : null;
    if (rango_m2_max      !== undefined) update.rango_m2_max      = rango_m2_max ? Number(rango_m2_max) : null;
    if (precio_en_rango   !== undefined) update.precio_en_rango   = precio_en_rango ? Number(precio_en_rango) : null;
    if (precio_minimo     !== undefined) update.precio_minimo     = precio_minimo ? Number(precio_minimo) : null;
    if (notas       !== undefined) update.notas        = notas;
    if (activo      !== undefined) update.activo       = activo !== false && activo !== 'false';
    if (orden       !== undefined) update.orden        = orden ? Number(orden) : null;

    const { data, error } = await supabase
      .from('precios_servicios')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/cotizacion/precios — admin: add new service
router.post('/precios', async (req, res) => {
  try {
    const {
      codigo, categoria, servicio, descripcion, tipo_precio,
      precio_fijo, precio_por_m2, rango_m2_min, rango_m2_max,
      precio_en_rango, precio_minimo, notas, orden
    } = req.body;
    if (!codigo || !servicio) return res.status(400).json({ error: 'codigo y servicio son requeridos.' });
    const { data, error } = await supabase
      .from('precios_servicios')
      .insert([{
        codigo: codigo.trim().toLowerCase().replace(/\s+/g, '_'),
        categoria: categoria || 'General',
        servicio,
        descripcion: descripcion || '',
        tipo_precio: tipo_precio || 'fijo',
        precio_fijo:     precio_fijo     ? Number(precio_fijo)     : null,
        precio_por_m2:   precio_por_m2   ? Number(precio_por_m2)   : null,
        rango_m2_min:    rango_m2_min    ? Number(rango_m2_min)    : null,
        rango_m2_max:    rango_m2_max    ? Number(rango_m2_max)    : null,
        precio_en_rango: precio_en_rango ? Number(precio_en_rango) : null,
        precio_minimo:   precio_minimo   ? Number(precio_minimo)   : null,
        notas: notas || null,
        activo: true,
        orden: orden ? Number(orden) : null,
      }])
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/cotizacion/precios/:id — admin: soft-delete (activo=false)
router.delete('/precios/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('precios_servicios')
      .update({ activo: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Servicio desactivado.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Core business logic — shared by the HTTP endpoint and the WA agent tool.
// Returns { _zonaRoja: true } when the zone is blocked (caller maps to HTTP 202).
// Returns the result object on success, or throws on DB error.
async function crearCotizacionBorradorCore({
  tipo_servicio, m2, zona, nombre, email, telefono,
  plazo, canal, detalles_adicionales, conversacion_id,
  moneda = 'GTQ',
}) {
  const { data: zonaData } = await supabase
    .from('zonas_seguridad')
    .select('*')
    .ilike('zona', `%${zona || ''}%`)
    .maybeSingle();

  const nivelRiesgo = zonaData?.nivel_riesgo || 'verde';

  if (nivelRiesgo === 'rojo' && !zonaData?.aceptar_trabajos) {
    await notifyAdmin(
      `⚠️ *ZONA ROJA DETECTADA*\n` +
      `Cliente: ${nombre} (${email})\n` +
      `Zona: ${zona}\n` +
      `Servicio: ${tipo_servicio}\n` +
      `Responde: OK para proceder o ignora para rechazar`
    );
    await supabase.from('notificaciones_admin').insert([{
      tipo: 'zona_roja',
      contenido: `Zona roja detectada: ${nombre} en ${zona} solicita ${tipo_servicio}`,
    }]);
    return { _zonaRoja: true };
  }

  if (nivelRiesgo === 'rojo' || zonaData?.requiere_verificacion_extra) {
    await notifyAdmin(
      `🔶 *ZONA REQUIERE VERIFICACIÓN*\n` +
      `Cliente: ${nombre} (${email})\n` +
      `Zona: ${zona} [${nivelRiesgo.toUpperCase()}]\n` +
      `Servicio: ${tipo_servicio}`
    );
  }

  // montoBase: pre-IVA service fee from pricing table / fallback.
  // Matches how the CRM admin stores servicios[i].subtotal (pre-IVA),
  // then adds IVA 12% on top — same as saveCotizacion() in admin.html.
  const montoBase = (await calcularMonto(tipo_servicio, m2)) || 0;
  const m2Num     = Number(m2) || 0;
  const ivaMonto  = Math.round(montoBase * 0.12 * 100) / 100;
  const total     = Math.round((montoBase + ivaMonto) * 100) / 100;

  const NOMBRES_SERVICIO = {
    'escaneo_3d':   'Escaneo 3D',
    'as_built':     'Levantamiento As-Built',
    'real_estate':  'Fotografía Inmobiliaria',
    'construccion': 'Servicios de Construcción',
  };
  const descServicio  = NOMBRES_SERVICIO[tipo_servicio] || tipo_servicio;
  const tipoPrecio    = m2Num > 0 ? 'por_m2' : 'fijo';
  const precioUnit    = m2Num > 0 ? Math.round(montoBase / m2Num * 100) / 100 : montoBase;

  let { data: cliente } = await supabase
    .from('clientes').select('id').eq('email', email).maybeSingle();
  if (!cliente) {
    const { data: newCliente } = await supabase
      .from('clientes')
      .insert([{ nombre, email, telefono: telefono || '', tipo: 'Lead' }])
      .select().single();
    cliente = newCliente;
  }

  // Formato rico — idéntico al que produce saveCotizacion() del CRM manual:
  // servicios[i].subtotal = pre-IVA; iva_monto y total calculados encima.
  // monto en cotizaciones = total con IVA (igual que en cotizaciones manuales).
  const detalles = {
    servicios: [{
      descripcion:     `${descServicio}${m2Num > 0 ? ` — ${m2Num} m²` : ''}`,
      tipo_precio:     tipoPrecio,
      cantidad:        m2Num > 0 ? m2Num : 1,
      precio_unitario: precioUnit,
      subtotal:        montoBase,
    }],
    subtotal:        montoBase,
    descuento_tipo:  'porcentaje',
    descuento_valor: 0,
    descuento_monto: 0,
    iva_porcentaje:  12,
    iva_monto:       ivaMonto,
    total,
    m2: m2Num, zona, plazo, detalles_adicionales,
    nivel_riesgo: nivelRiesgo,
    requiere_verificacion: zonaData?.requiere_verificacion_extra || false,
  };

  const { data: cot, error } = await supabase
    .from('cotizaciones')
    .insert([{
      cliente_id:      cliente.id,
      conversacion_id: conversacion_id || null,
      canal,
      tipo_servicio,
      monto:   total,                    // total con IVA — igual que cotizaciones manuales
      moneda,                            // GTQ por defecto desde el agente WA
      estado:  'borrador',
      detalles_json: detalles,
      anticipo: Math.round(total * 0.5), // 50% del total con IVA
    }])
    .select().single();
  if (error) throw error;

  // Formateo de moneda para notificaciones — los montos en DB son siempre USD;
  // si moneda='GTQ' se multiplica por TASA_GTQ para mostrar el valor que verá el cliente.
  const sym    = moneda === 'GTQ' ? 'Q' : '$';
  const factor = moneda === 'GTQ' ? TASA_GTQ : 1;
  const fmtN   = n => sym + Math.round(n * factor).toLocaleString('es-GT');

  const emoji = nivelRiesgo === 'rojo' ? '🔴' : nivelRiesgo === 'amarillo' ? '🟡' : '🟢';
  await notifyAdmin(
    `${emoji} *NUEVA COTIZACIÓN #${cot.id}*\n` +
    `Cliente: ${nombre}\n` +
    `Servicio: ${tipo_servicio.replace('_', ' ').toUpperCase()}\n` +
    `Metraje: ${m2Num || '?'} m²\n` +
    `Zona: ${zona || '—'} [${nivelRiesgo}]\n` +
    `Moneda: ${moneda}\n` +
    `Subtotal: ${fmtN(montoBase)} | IVA 12%: ${fmtN(ivaMonto)} | Total: ${fmtN(total)}\n` +
    `Canal: ${canal}\n\n` +
    `Responde: OK ${cot.id} para aprobar`
  );

  await supabase.from('notificaciones_admin').insert([{
    tipo: 'cotizacion_revision',
    referencia_id: cot.id,
    contenido: `Cotización #${cot.id} — ${nombre} — ${fmtN(total)} (total c/IVA) — ${tipo_servicio}`,
  }]);

  return {
    cotizacion_id: cot.id,
    monto: total,
    moneda,
    tipo_servicio,
    requiere_verificacion: zonaData?.requiere_verificacion_extra || false,
    mensaje: `Cotización generada. Monto estimado: ${fmtN(total)} ${moneda}. Te contactaremos para confirmar detalles.`,
  };
}

// POST /api/cotizacion/generar
router.post('/generar', async (req, res) => {
  try {
    const {
      tipo_servicio, m2, zona, nombre, email, telefono,
      plazo, canal = 'web', detalles_adicionales, conversacion_id,
      moneda,
    } = req.body;

    if (!tipo_servicio || !nombre || !email)
      return res.status(400).json({ error: 'tipo_servicio, nombre y email son requeridos' });

    const result = await crearCotizacionBorradorCore({
      tipo_servicio, m2, zona, nombre, email, telefono,
      plazo, canal, detalles_adicionales, conversacion_id,
      moneda,   // undefined → function default ('GTQ')
    });

    if (result._zonaRoja) {
      return res.status(202).json({
        message: 'Tu solicitud está siendo revisada. Te contactaremos en breve.',
        requiere_revision: true,
      });
    }

    res.status(201).json(result);
  } catch (e) {
    console.error('[CotizacionGen]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/cotizacion/zonas/:id — update zone (admin)
router.put('/zonas/:id', async (req, res) => {
  try {
    const { zona, nivel_riesgo, descripcion, aceptar_trabajos, requiere_verificacion_extra } = req.body;
    const { data, error } = await supabase
      .from('zonas_seguridad')
      .update({ zona, nivel_riesgo, descripcion, aceptar_trabajos, requiere_verificacion_extra })
      .eq('id', req.params.id)
      .select();
    if (error) throw error;
    res.json(data[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/cotizacion/zonas — create new zone (admin)
router.post('/zonas', async (req, res) => {
  try {
    const { zona, nivel_riesgo, descripcion, aceptar_trabajos, requiere_verificacion_extra } = req.body;
    const { data, error } = await supabase
      .from('zonas_seguridad')
      .insert([{ zona, nivel_riesgo, descripcion: descripcion || '', aceptar_trabajos: aceptar_trabajos ?? true, requiere_verificacion_extra: requiere_verificacion_extra ?? false }])
      .select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/cotizacion/zonas — public: zone risk list for frontend
router.get('/zonas', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('zonas_seguridad').select('id, zona, nivel_riesgo, requiere_verificacion_extra, aceptar_trabajos')
      .order('zona');
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.crearCotizacionBorradorCore = crearCotizacionBorradorCore;
