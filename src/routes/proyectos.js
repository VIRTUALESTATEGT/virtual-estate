const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('proyectos').select('*').order('id', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { nombre, cliente_id, fechaInicio, fechaFin, valor, estado, progreso } = req.body;
    const { data, error } = await supabase
      .from('proyectos')
      .insert([{ nombre, cliente_id, fechainicio: fechaInicio, fechafin: fechaFin, valor, estado, progreso }])
      .select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { nombre, cliente_id, fechaInicio, fechaFin, valor, estado, progreso } = req.body;
    const { data, error } = await supabase
      .from('proyectos')
      .update({ nombre, cliente_id, fechainicio: fechaInicio, fechafin: fechaFin, valor, estado, progreso })
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
    const { error } = await supabase.from('proyectos').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Proyecto eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
