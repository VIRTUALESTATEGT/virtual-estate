const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('cotizaciones')
      .select('*, clientes(id, nombre)')
      .order('id', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { cliente_id, proyecto_id, monto, anticipo, estado, tipo_servicio, canal } = req.body;
    const { data, error } = await supabase
      .from('cotizaciones')
      .insert([{ cliente_id, proyecto_id, monto, anticipo, estado, tipo_servicio, canal: canal || 'crm' }])
      .select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { cliente_id, proyecto_id, monto, anticipo, estado, tipo_servicio, canal } = req.body;
    const updateObj = { cliente_id, proyecto_id, monto, anticipo, estado };
    if (tipo_servicio !== undefined) updateObj.tipo_servicio = tipo_servicio;
    if (canal !== undefined) updateObj.canal = canal;
    const { data, error } = await supabase
      .from('cotizaciones')
      .update(updateObj)
      .eq('id', req.params.id)
      .select();
    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('cotizaciones').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Cotización eliminada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
