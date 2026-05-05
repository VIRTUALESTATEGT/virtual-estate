const express  = require('express');
const router   = express.Router();
const supabase = require('../config/supabase');

// GET /api/conversaciones — list all (admin)
router.get('/', async (req, res) => {
  try {
    const { estado } = req.query;
    let q = supabase
      .from('conversaciones_multicanal')
      .select('*, clientes(nombre, email, telefono)')
      .order('timestamp', { ascending: false });
    if (estado) q = q.eq('estado', estado);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/conversaciones/pendientes — low-confidence IA convs needing human review
router.get('/pendientes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('conversaciones_multicanal')
      .select('*, clientes(nombre, email, telefono)')
      .eq('estado', 'activa')
      .eq('ultima_respuesta_tipo', 'ia')
      .order('timestamp', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/conversaciones/:id/mensajes
router.get('/:id/mensajes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('mensajes')
      .select('*')
      .eq('conversacion_id', req.params.id)
      .order('timestamp', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/conversaciones/:id/mensajes — agent sends manual reply
router.post('/:id/mensajes', async (req, res) => {
  try {
    const { contenido, remitente_tipo = 'agente_humano' } = req.body;
    if (!contenido) return res.status(400).json({ error: 'contenido requerido' });
    const { data, error } = await supabase
      .from('mensajes')
      .insert([{ conversacion_id: Number(req.params.id), remitente_tipo, contenido }])
      .select().single();
    if (error) throw error;
    await supabase.from('conversaciones_multicanal')
      .update({ ultima_respuesta_tipo: 'agente_humano', timestamp: new Date().toISOString() })
      .eq('id', req.params.id);
    res.status(201).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/conversaciones/:id — update estado
router.patch('/:id', async (req, res) => {
  try {
    const { estado } = req.body;
    const { data, error } = await supabase
      .from('conversaciones_multicanal')
      .update({ estado })
      .eq('id', req.params.id)
      .select().maybeSingle();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
