const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const verificarPermiso = require('../middleware/permisos');

// GET / — list with optional filters
router.get('/', async (req, res) => {
  try {
    let q = supabase.from('propiedades').select('*').order('id', { ascending: false });
    const { zona, tipo, modalidad, precio_min, precio_max, m2_min, m2_max } = req.query;
    if (zona)      q = q.ilike('zona', `%${zona}%`);
    if (tipo)      q = q.eq('tipo', tipo);
    if (modalidad) q = q.eq('modalidad', modalidad);
    if (precio_min) q = q.gte('precio', Number(precio_min));
    if (precio_max) q = q.lte('precio', Number(precio_max));
    if (m2_min)    q = q.gte('m2', Number(m2_min));
    if (m2_max)    q = q.lte('m2', Number(m2_max));
    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST / — create property (requires crear_propiedad)
router.post('/', verificarPermiso('crear_propiedad'), async (req, res) => {
  try {
    const { nombre, tipo, modalidad, precio, m2, zona, linkTour3D } = req.body;
    const { data, error } = await supabase
      .from('propiedades')
      .insert([{ nombre, tipo, modalidad, precio, m2, zona, linktour3d: linkTour3D }])
      .select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /:id — update property
router.put('/:id', verificarPermiso('editar_propiedad'), async (req, res) => {
  try {
    const { nombre, tipo, modalidad, precio, m2, zona, linkTour3D } = req.body;
    const { data, error } = await supabase
      .from('propiedades')
      .update({ nombre, tipo, modalidad, precio, m2, zona, linktour3d: linkTour3D })
      .eq('id', req.params.id)
      .select();
    if (error) throw error;
    res.json(data[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /:id — delete property (requires eliminar_propiedad)
router.delete('/:id', verificarPermiso('eliminar_propiedad'), async (req, res) => {
  try {
    const { error } = await supabase.from('propiedades').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Propiedad eliminada' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /:id/adicionales — get adicionales for a property
router.get('/:id/adicionales', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('propiedades_adicionales')
      .select('*')
      .eq('propiedad_id', req.params.id)
      .order('tipo');
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /:id/adicionales — replace all adicionales (requires crear_propiedad)
router.post('/:id/adicionales', verificarPermiso('crear_propiedad'), async (req, res) => {
  try {
    const { adicionales } = req.body; // [{tipo, nombre}]
    if (!Array.isArray(adicionales))
      return res.status(400).json({ error: 'adicionales debe ser un array.' });
    await supabase.from('propiedades_adicionales').delete().eq('propiedad_id', req.params.id);
    if (!adicionales.length) return res.json([]);
    const rows = adicionales.map(a => ({
      propiedad_id: Number(req.params.id),
      tipo: a.tipo,
      nombre: a.nombre,
    }));
    const { data, error } = await supabase.from('propiedades_adicionales').insert(rows).select();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
