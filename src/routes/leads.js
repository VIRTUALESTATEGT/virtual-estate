const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// GET todos los leads
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('leads').select('*').order('id', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/leads/pipeline — lista unificada: leads web + prospectos WhatsApp (clientes tipo='Lead')
// Debe definirse ANTES de /:id para no ser atrapado como parámetro.
router.get('/pipeline', async (req, res) => {
  try {
    const [leadsRes, clientesRes] = await Promise.all([
      supabase.from('leads').select('*').order('id', { ascending: false }),
      supabase
        .from('clientes')
        .select('id, nombre, apellido, email, telefono, empresa, cotizaciones(id, tipo_servicio, monto, moneda, estado)')
        .eq('tipo', 'Lead')
        .order('id', { ascending: false }),
    ]);

    if (leadsRes.error) throw leadsRes.error;
    if (clientesRes.error) throw clientesRes.error;

    const COT_ESTADO = { borrador: 'Nuevo', enviada: 'Cotizado', pendiente: 'En seguimiento' };

    const fmtMonto = (monto, moneda) => {
      const m = Number(monto) || 0;
      return moneda === 'GTQ'
        ? 'Q ' + (m * 7.90).toLocaleString('es-GT', { minimumFractionDigits: 2 })
        : '$ ' + m.toLocaleString('es-GT', { minimumFractionDigits: 2 });
    };

    const webLeads = (leadsRes.data || []).map(l => ({
      _id:         `L-${l.id}`,
      _origen:     'web',
      nombre:      l.nombre,
      apellido:    l.apellido    || null,
      email:       l.email       || null,
      telefono:    l.telefono    || null,
      empresa:     l.empresa     || null,
      servicio:    l.servicio    || null,
      presupuesto: l.presupuesto || null,
      estado:      l.estado      || 'Nuevo',
      fuente:      l.fuente      || null,
      seguimiento: l.seguimiento || null,
      _cot_id:     null,
    }));

    const waLeads = (clientesRes.data || []).map(c => {
      const cot = (c.cotizaciones || []).sort((a, b) => b.id - a.id)[0] || null;
      return {
        _id:         `C-${c.id}`,
        _origen:     'whatsapp',
        nombre:      c.nombre,
        apellido:    c.apellido  || null,
        email:       c.email     || null,
        telefono:    c.telefono  || null,
        empresa:     c.empresa   || null,
        servicio:    cot?.tipo_servicio || null,
        presupuesto: cot ? fmtMonto(cot.monto, cot.moneda) : null,
        estado:      cot ? (COT_ESTADO[cot.estado] || 'Nuevo') : 'Nuevo',
        fuente:      'WhatsApp',
        seguimiento: null,
        _cot_id:     cot?.id || null,
      };
    });

    res.json([...webLeads, ...waLeads]);
  } catch (e) {
    console.error('[LEADS PIPELINE]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST nuevo lead
router.post('/', async (req, res) => {
  try {
    const { nombre, apellido, email, telefono, empresa, estado, servicio, fuente, presupuesto, seguimiento } = req.body;
    const { data, error } = await supabase
      .from('leads')
      .insert([{ nombre, apellido: apellido || null, email, telefono, empresa, estado: estado || 'Nuevo', servicio, fuente, presupuesto, seguimiento }])
      .select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /:id — update lead
router.put('/:id', async (req, res) => {
  try {
    const { nombre, apellido, email, telefono, empresa, estado, seguimiento, servicio, fuente, presupuesto } = req.body;
    const { data, error } = await supabase
      .from('leads')
      .update({ nombre, apellido: apellido || null, email, telefono, empresa, estado, seguimiento, servicio, fuente, presupuesto })
      .eq('id', req.params.id)
      .select();
    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE lead por ID — cascada: borra cotizaciones y datos WhatsApp relacionados
router.delete('/:id', async (req, res) => {
  const id = req.params.id;
  try {
    // Obtener teléfono antes de borrar (para limpiar tablas WhatsApp)
    const { data: lead } = await supabase.from('leads').select('telefono').eq('id', id).maybeSingle();
    const tel = lead?.telefono;

    // 1. Cotizaciones del lead
    await supabase.from('cotizaciones').delete().eq('lead_id', id);

    // 2. Datos de seguimiento WhatsApp (si existen, ignorar error si la tabla no existe)
    if (tel) {
      await supabase.from('prospect_tracking').delete().eq('phone_number', tel).then(() => {}).catch(() => {});
      await supabase.from('whatsapp_messages').delete().eq('phone_number', tel).then(() => {}).catch(() => {});
    }

    // 3. Borrar el lead
    const { error } = await supabase.from('leads').delete().eq('id', id);
    if (error) throw error;

    res.json({ message: 'Lead y datos relacionados eliminados' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
