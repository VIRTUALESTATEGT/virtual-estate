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
    const { nombre, email, telefono, empresa, estado, servicio, fuente, presupuesto, seguimiento } = req.body;
    const { data, error } = await supabase
      .from('leads')
      .insert([{ nombre, email, telefono, empresa, estado: estado || 'Nuevo', servicio, fuente, presupuesto, seguimiento }])
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
    const { nombre, email, telefono, empresa, estado, seguimiento, servicio, fuente, presupuesto } = req.body;
    const { data, error } = await supabase
      .from('leads')
      .update({ nombre, email, telefono, empresa, estado, seguimiento, servicio, fuente, presupuesto })
      .eq('id', req.params.id)
      .select();
    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE lead por ID
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('leads').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Lead eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
