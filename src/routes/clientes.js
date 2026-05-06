const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('clientes').select('*').order('id', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { nombre, email, telefono, empresa, tipo } = req.body;
    const { data, error } = await supabase
      .from('clientes')
      .insert([{ nombre, email, telefono, empresa, tipo }])
      .select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { nombre, email, telefono, empresa, tipo } = req.body;
    const { data, error } = await supabase
      .from('clientes')
      .update({ nombre, email, telefono, empresa, tipo })
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
    const { error } = await supabase.from('clientes').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Cliente eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── PORTAL ENDPOINTS ────────────────────────────────────────────────────────

// GET /api/clientes/me — find client record by JWT email
router.get('/me', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .eq('email', req.usuario.email)
      .maybeSingle();
    if (error) throw error;
    res.json(data || null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/clientes/me — update client profile by JWT email
router.put('/me', async (req, res) => {
  try {
    const { nombre, telefono, empresa } = req.body;
    const { data, error } = await supabase
      .from('clientes')
      .update({ nombre, telefono, empresa })
      .eq('email', req.usuario.email)
      .select()
      .maybeSingle();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/clientes/me/cotizaciones — cotizaciones linked to this client
router.get('/me/cotizaciones', async (req, res) => {
  try {
    const { data: cliente, error: ce } = await supabase
      .from('clientes')
      .select('id')
      .eq('email', req.usuario.email)
      .maybeSingle();
    if (ce) throw ce;
    if (!cliente) return res.json([]);

    const { data, error } = await supabase
      .from('cotizaciones')
      .select('*')
      .eq('cliente_id', cliente.id)
      .order('id', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── FAVORITOS EN BD ─────────────────────────────────────────────────────────

// GET /api/clientes/me/favoritos
router.get('/me/favoritos', async (req, res) => {
  try {
    const { data: cliente } = await supabase
      .from('clientes').select('id').eq('email', req.usuario.email).maybeSingle();
    if (!cliente) return res.json([]);
    const { data, error } = await supabase
      .from('propiedades_favoritas')
      .select('*, propiedades(*)')
      .eq('cliente_id', cliente.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/clientes/me/favoritos  { propiedad_id }
router.post('/me/favoritos', async (req, res) => {
  try {
    const { propiedad_id } = req.body;
    if (!propiedad_id) return res.status(400).json({ error: 'propiedad_id requerido.' });
    const { data: cliente } = await supabase
      .from('clientes').select('id').eq('email', req.usuario.email).maybeSingle();
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado.' });
    const { data, error } = await supabase
      .from('propiedades_favoritas')
      .upsert([{ cliente_id: cliente.id, propiedad_id: Number(propiedad_id) }],
        { onConflict: 'cliente_id,propiedad_id' })
      .select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/clientes/me/favoritos/:propiedad_id
router.delete('/me/favoritos/:propiedad_id', async (req, res) => {
  try {
    const { data: cliente } = await supabase
      .from('clientes').select('id').eq('email', req.usuario.email).maybeSingle();
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado.' });
    const { error } = await supabase
      .from('propiedades_favoritas')
      .delete()
      .eq('cliente_id', cliente.id)
      .eq('propiedad_id', req.params.propiedad_id);
    if (error) throw error;
    res.json({ message: 'Favorito eliminado.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
