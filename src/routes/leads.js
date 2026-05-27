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
