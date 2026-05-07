const express  = require('express');
const router   = express.Router();
const supabase = require('../config/supabase');
const { notifyAdmin, sendWhatsAppMessage } = require('../utils/whatsapp');

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
      .select('id, codigo, nombre, descripcion, precio_base, precio_por_m2, precio_minimo, moneda, activo')
      .order('id');
    if (error) throw error;
    res.json(data);
  } catch {
    // Table may not exist yet — return fallback list
    res.json(Object.entries(PRICING_FALLBACK).map(([codigo, p], i) => ({
      id: i + 1, codigo, nombre: codigo.replace('_', ' ').toUpperCase(),
      descripcion: '', precio_base: p.base, precio_por_m2: p.per_m2,
      precio_minimo: p.min, moneda: 'USD', activo: true
    })));
  }
});

// PUT /api/cotizacion/precios/:id — admin: update a service price
router.put('/precios/:id', async (req, res) => {
  try {
    const { nombre, descripcion, precio_base, precio_por_m2, precio_minimo, activo } = req.body;
    const { data, error } = await supabase
      .from('precios_servicios')
      .update({ nombre, descripcion, precio_base: Number(precio_base), precio_por_m2: Number(precio_por_m2), precio_minimo: Number(precio_minimo), activo: activo !== false })
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
    const { codigo, nombre, descripcion, precio_base, precio_por_m2, precio_minimo } = req.body;
    if (!codigo || !nombre) return res.status(400).json({ error: 'codigo y nombre son requeridos.' });
    const { data, error } = await supabase
      .from('precios_servicios')
      .insert([{ codigo, nombre, descripcion: descripcion||'', precio_base: Number(precio_base)||0, precio_por_m2: Number(precio_por_m2)||0, precio_minimo: Number(precio_minimo)||0, moneda: 'USD', activo: true }])
      .select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/cotizacion/precios/:id — admin: remove service
router.delete('/precios/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('precios_servicios').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Servicio eliminado.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/cotizacion/generar
router.post('/generar', async (req, res) => {
  try {
    const {
      tipo_servicio, m2, zona, nombre, email, telefono,
      plazo, canal = 'web', detalles_adicionales, conversacion_id
    } = req.body;

    if (!tipo_servicio || !nombre || !email)
      return res.status(400).json({ error: 'tipo_servicio, nombre y email son requeridos' });

    // Zone risk check
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
      return res.status(202).json({
        message: 'Tu solicitud está siendo revisada. Te contactaremos en breve.',
        requiere_revision: true
      });
    }

    if (nivelRiesgo === 'rojo' || zonaData?.requiere_verificacion_extra) {
      await notifyAdmin(
        `🔶 *ZONA REQUIERE VERIFICACIÓN*\n` +
        `Cliente: ${nombre} (${email})\n` +
        `Zona: ${zona} [${nivelRiesgo.toUpperCase()}]\n` +
        `Servicio: ${tipo_servicio}`
      );
    }

    // Calculate amount
    const monto = (await calcularMonto(tipo_servicio, m2)) || 0;

    // Find or create client
    let { data: cliente } = await supabase
      .from('clientes').select('id').eq('email', email).maybeSingle();
    if (!cliente) {
      const { data: newCliente } = await supabase
        .from('clientes')
        .insert([{ nombre, email, telefono: telefono || '', tipo: 'Lead' }])
        .select().single();
      cliente = newCliente;
    }

    // Save cotizacion
    const detalles = {
      m2: m2 || 0, zona, plazo, detalles_adicionales,
      nivel_riesgo: nivelRiesgo, requiere_verificacion: zonaData?.requiere_verificacion_extra || false
    };

    const { data: cot, error } = await supabase
      .from('cotizaciones')
      .insert([{
        cliente_id: cliente.id,
        conversacion_id: conversacion_id || null,
        canal,
        tipo_servicio,
        monto,
        moneda: 'USD',
        estado: 'borrador',
        detalles_json: detalles,
        anticipo: Math.round(monto * 0.5),
      }])
      .select().single();
    if (error) throw error;

    // Notify admin
    const emoji = nivelRiesgo === 'rojo' ? '🔴' : nivelRiesgo === 'amarillo' ? '🟡' : '🟢';
    await notifyAdmin(
      `${emoji} *NUEVA COTIZACIÓN #${cot.id}*\n` +
      `Cliente: ${nombre}\n` +
      `Servicio: ${tipo_servicio.replace('_', ' ').toUpperCase()}\n` +
      `Metraje: ${m2 || '?'} m²\n` +
      `Zona: ${zona || '—'} [${nivelRiesgo}]\n` +
      `Monto: $${monto.toLocaleString()} USD\n` +
      `Canal: ${canal}\n\n` +
      `Responde: OK ${cot.id} para aprobar`
    );

    await supabase.from('notificaciones_admin').insert([{
      tipo: 'cotizacion_revision',
      referencia_id: cot.id,
      contenido: `Cotización #${cot.id} — ${nombre} — $${monto} — ${tipo_servicio}`,
    }]);

    res.status(201).json({
      cotizacion_id: cot.id,
      monto,
      moneda: 'USD',
      tipo_servicio,
      requiere_verificacion: zonaData?.requiere_verificacion_extra || false,
      mensaje: `Cotización generada. Monto estimado: $${monto} USD. Te contactaremos para confirmar detalles.`
    });
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
      .from('zonas_seguridad').select('zona, nivel_riesgo, requiere_verificacion_extra, aceptar_trabajos')
      .order('zona');
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
