const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const sharp    = require('sharp');
const supabase = require('../config/supabase');
const verificarPermiso = require('../middleware/permisos');

const DISP_ALLOWED = new Set(['vacia', 'habitada', 'airbnb', 'en_construccion']);
const MOD_ALLOWED  = new Set(['venta', 'renta']);
const FOTO_MIME    = new Set(['image/jpeg', 'image/png', 'image/webp']);

// ── Foto upload middleware ────────────────────────────────────────────────────
const fotoUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = FOTO_MIME.has(file.mimetype);
    cb(ok ? null : new Error('Solo JPEG, PNG o WEBP permitidos'), ok);
  },
});

// ── Propiedades CRUD ──────────────────────────────────────────────────────────

// GET / — list with optional filters (CRM). select(*) picks up foto_principal_url automatically.
router.get('/', async (req, res) => {
  try {
    let q = supabase.from('propiedades').select('*').order('id', { ascending: false });
    const { zona, tipo, modalidad, precio_min, precio_max, m2_min, m2_max } = req.query;
    const modVals = modalidad ? modalidad.split(',').map(v => v.trim()).filter(v => MOD_ALLOWED.has(v)) : [];
    if (zona)            q = q.ilike('zona', `%${zona}%`);
    if (tipo)            q = q.eq('tipo', tipo);
    if (modVals.length)  q = q.overlaps('modalidad', modVals);
    if (precio_min)      q = q.gte('precio', Number(precio_min));
    if (precio_max)      q = q.lte('precio', Number(precio_max));
    if (m2_min)          q = q.gte('m2', Number(m2_min));
    if (m2_max)          q = q.lte('m2', Number(m2_max));
    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST / — create property
router.post('/', verificarPermiso('crear_propiedad'), async (req, res) => {
  try {
    const { nombre, tipo, modalidad, precio, m2, zona, linkTour3D, disponibilidad } = req.body;
    const disp = Array.isArray(disponibilidad) ? disponibilidad.filter(v => DISP_ALLOWED.has(v)) : [];
    const mod  = Array.isArray(modalidad)      ? modalidad.filter(v => MOD_ALLOWED.has(v))       : [];
    const { data, error } = await supabase
      .from('propiedades')
      .insert([{ nombre, tipo, modalidad: mod, precio, m2, zona, linktour3d: linkTour3D, disponibilidad: disp }])
      .select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /:id — update property (must be registered before /:id/fotos/*)
router.put('/:id', verificarPermiso('editar_propiedad'), async (req, res) => {
  try {
    const { nombre, tipo, modalidad, precio, m2, zona, linkTour3D, disponibilidad } = req.body;
    const disp = Array.isArray(disponibilidad) ? disponibilidad.filter(v => DISP_ALLOWED.has(v)) : [];
    const mod  = Array.isArray(modalidad)      ? modalidad.filter(v => MOD_ALLOWED.has(v))       : [];
    const { data, error } = await supabase
      .from('propiedades')
      .update({ nombre, tipo, modalidad: mod, precio, m2, zona, linktour3d: linkTour3D, disponibilidad: disp })
      .eq('id', req.params.id)
      .select();
    if (error) throw error;
    res.json(data[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /:id — delete property
router.delete('/:id', verificarPermiso('eliminar_propiedad'), async (req, res) => {
  try {
    const { error } = await supabase.from('propiedades').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Propiedad eliminada' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Adicionales ───────────────────────────────────────────────────────────────

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

router.post('/:id/adicionales', verificarPermiso('crear_propiedad'), async (req, res) => {
  try {
    const { adicionales } = req.body;
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

// ── Fotos ─────────────────────────────────────────────────────────────────────

// GET /:id/fotos — all photos, ordered
router.get('/:id/fotos', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('propiedad_fotos')
      .select('*')
      .eq('propiedad_id', req.params.id)
      .order('orden')
      .order('id');
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /:id/fotos — upload one photo (multipart/form-data, field "foto")
router.post('/:id/fotos', verificarPermiso('editar_propiedad'), (req, res) => {
  fotoUpload.single('foto')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido.' });

    const propiedadId = Number(req.params.id);
    try {
      // Server-side compression: max 1920px wide, no upscale, JPEG 80
      const buffer = await sharp(req.file.buffer)
        .resize({ width: 1920, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

      const storagePath = `propiedades/${propiedadId}/${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from('virtual-estate-images')
        .upload(storagePath, buffer, { contentType: 'image/jpeg' });
      if (upErr) throw upErr;

      const { data: { publicUrl } } = supabase.storage
        .from('virtual-estate-images')
        .getPublicUrl(storagePath);

      // Determine orden and whether this is the first photo
      const { data: existing } = await supabase
        .from('propiedad_fotos')
        .select('orden')
        .eq('propiedad_id', propiedadId)
        .order('orden', { ascending: false })
        .limit(1);

      const esPrimera = !existing || existing.length === 0;
      const orden     = esPrimera ? 0 : (existing[0].orden + 1);

      const { data: foto, error: dbErr } = await supabase
        .from('propiedad_fotos')
        .insert([{
          propiedad_id:   propiedadId,
          url:            publicUrl,
          storage_path:   storagePath,
          orden,
          es_principal:   esPrimera,
          nombre_archivo: req.file.originalname,
        }])
        .select()
        .single();
      if (dbErr) throw dbErr;

      if (esPrimera) {
        await supabase.from('propiedades')
          .update({ foto_principal_url: publicUrl })
          .eq('id', propiedadId);
      }

      res.status(201).json(foto);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
});

// DELETE /:id/fotos/:fotoId — remove photo, promote next if it was the principal
router.delete('/:id/fotos/:fotoId', verificarPermiso('editar_propiedad'), async (req, res) => {
  const propiedadId = Number(req.params.id);
  const fotoId      = Number(req.params.fotoId);
  try {
    const { data: foto, error: fetchErr } = await supabase
      .from('propiedad_fotos')
      .select('*')
      .eq('id', fotoId)
      .eq('propiedad_id', propiedadId)
      .single();
    if (fetchErr || !foto) return res.status(404).json({ error: 'Foto no encontrada.' });

    await supabase.storage.from('virtual-estate-images').remove([foto.storage_path]);
    await supabase.from('propiedad_fotos').delete().eq('id', fotoId);

    if (foto.es_principal) {
      // Promote the next photo in order
      const { data: siguiente } = await supabase
        .from('propiedad_fotos')
        .select('id, url')
        .eq('propiedad_id', propiedadId)
        .order('orden')
        .order('id')
        .limit(1)
        .maybeSingle();

      if (siguiente) {
        await supabase.from('propiedad_fotos')
          .update({ es_principal: true })
          .eq('id', siguiente.id);
        await supabase.from('propiedades')
          .update({ foto_principal_url: siguiente.url })
          .eq('id', propiedadId);
      } else {
        await supabase.from('propiedades')
          .update({ foto_principal_url: null })
          .eq('id', propiedadId);
      }
    }

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /:id/fotos/:fotoId/principal — set cover photo
router.put('/:id/fotos/:fotoId/principal', verificarPermiso('editar_propiedad'), async (req, res) => {
  const propiedadId = Number(req.params.id);
  const fotoId      = Number(req.params.fotoId);
  try {
    const { data: foto, error: fetchErr } = await supabase
      .from('propiedad_fotos')
      .select('url')
      .eq('id', fotoId)
      .eq('propiedad_id', propiedadId)
      .single();
    if (fetchErr || !foto) return res.status(404).json({ error: 'Foto no encontrada.' });

    // Unmark all, then mark the chosen one
    await supabase.from('propiedad_fotos')
      .update({ es_principal: false })
      .eq('propiedad_id', propiedadId);
    await supabase.from('propiedad_fotos')
      .update({ es_principal: true })
      .eq('id', fotoId);
    await supabase.from('propiedades')
      .update({ foto_principal_url: foto.url })
      .eq('id', propiedadId);

    res.json({ ok: true, url: foto.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /:id/fotos/orden — reorder photos, receives ids[] in new order
router.put('/:id/fotos/orden', verificarPermiso('editar_propiedad'), async (req, res) => {
  const propiedadId = Number(req.params.id);
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.some(v => typeof v !== 'number'))
    return res.status(400).json({ error: 'ids debe ser un array de números.' });
  try {
    await Promise.all(
      ids.map((fotoId, index) =>
        supabase.from('propiedad_fotos')
          .update({ orden: index })
          .eq('id', fotoId)
          .eq('propiedad_id', propiedadId)
      )
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
