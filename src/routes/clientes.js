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

module.exports = router;
