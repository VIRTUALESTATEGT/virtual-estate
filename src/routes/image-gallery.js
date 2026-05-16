const express = require('express');
const multer  = require('multer');
const supabase = require('../config/supabase');
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

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

// POST - Subir archivo a Supabase Storage y guardar en BD
router.post('/upload-image', upload.single('file'), async (req, res) => {
  try {
    const businessId = BIZ_ID(req);

    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const { type, description, category, what_to_copy } = req.body;
    const fileName = `${businessId}/${type}/${Date.now()}-${req.file.originalname}`;

    const { error: uploadError } = await supabase.storage
      .from('virtual-estate-images')
      .upload(fileName, req.file.buffer, { contentType: req.file.mimetype });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('virtual-estate-images')
      .getPublicUrl(fileName);

    const image_url = urlData.publicUrl;

    const table = type === 'brand' ? 'brand_images' : 'image_references';
    const insertData = { business_id: businessId, image_url, category: category || 'general' };

    if (type === 'brand') {
      insertData.image_description = description;
    } else {
      insertData.reference_description = description;
      insertData.what_to_copy = what_to_copy;
    }

    const { data: dbData, error: dbError } = await supabase
      .from(table)
      .insert([insertData])
      .select();

    if (dbError) throw dbError;

    res.json({ success: true, image: dbData[0], url: image_url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
