const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('constructores').select('*').order('id', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { nombre_empresa, contacto, especialidad, email, telefono, estado, notas } = req.body;
    if (!nombre_empresa) return res.status(400).json({ error: 'nombre_empresa es requerido' });
    const { data, error } = await supabase
      .from('constructores')
      .insert([{ nombre_empresa, contacto, especialidad, email, telefono, estado: estado || 'Activo', notas }])
      .select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { nombre_empresa, contacto, especialidad, email, telefono, estado, notas } = req.body;
    const { data, error } = await supabase
      .from('constructores')
      .update({ nombre_empresa, contacto, especialidad, email, telefono, estado, notas })
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
    const { error } = await supabase.from('constructores').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Constructor eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
