const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('propiedades').select('*').order('id', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { nombre, tipo, modalidad, precio, m2, zona, linkTour3D } = req.body;
    const { data, error } = await supabase
      .from('propiedades')
      .insert([{ nombre, tipo, modalidad, precio, m2, zona, linktour3d: linkTour3D }])
      .select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('propiedades').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Propiedad eliminada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
