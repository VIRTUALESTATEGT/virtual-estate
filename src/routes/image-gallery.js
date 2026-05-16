const express = require('express');
const supabase = require('../config/supabase');
const router = express.Router();

const BIZ_ID = (req) => req.user?.id || 'virtual-estate';

// GET - Listar imágenes de marca
router.get('/brand-images', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('brand_images')
      .select('*')
      .eq('business_id', BIZ_ID(req))
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ images: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET - Listar referencias visuales
router.get('/references', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('image_references')
      .select('*')
      .eq('business_id', BIZ_ID(req))
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ references: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST - Agregar imagen a galería
router.post('/brand-images', async (req, res) => {
  try {
    const { image_url, image_description, category } = req.body;
    const { data, error } = await supabase
      .from('brand_images')
      .insert([{
        business_id: BIZ_ID(req),
        image_url,
        image_description,
        category: category || 'general'
      }])
      .select();
    if (error) throw error;
    res.json({ success: true, image: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST - Agregar referencia visual
router.post('/references', async (req, res) => {
  try {
    const { image_url, reference_description, what_to_copy, category } = req.body;
    const { data, error } = await supabase
      .from('image_references')
      .insert([{
        business_id: BIZ_ID(req),
        image_url,
        reference_description,
        what_to_copy,
        category: category || 'general'
      }])
      .select();
    if (error) throw error;
    res.json({ success: true, reference: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE - Eliminar imagen de marca
router.delete('/brand-images/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('brand_images')
      .delete()
      .eq('id', req.params.id)
      .eq('business_id', BIZ_ID(req));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE - Eliminar referencia visual
router.delete('/references/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('image_references')
      .delete()
      .eq('id', req.params.id)
      .eq('business_id', BIZ_ID(req));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
