const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// Solo staff accede a rutas de gestión; el cliente queda limitado a /me*
router.use((req, res, next) => {
  const esCliente = (req.usuario?.role || req.usuario?.rol) === 'cliente'
                    && !req.usuario?.is_superadmin;
  if (esCliente && !req.path.startsWith('/me')) {
    return res.status(403).json({ error: 'Acceso denegado.' });
  }
  next();
});

router.get('/', async (req, res) => {
  try {
    let query = supabase.from('clientes').select('*').order('id', { ascending: false });
    if (req.query.tipo) query = query.eq('tipo', req.query.tipo);
    const { data, error } = await query;
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

// ── PORTAL ENDPOINTS — must be defined BEFORE /:id to avoid param shadowing ──

// GET /api/clientes/me — find client record by JWT email
router.get('/me', async (req, res) => {
  console.log('[CLIENTES/ME] GET — usuario:', req.usuario?.email);
  try {
    if (!req.usuario?.email) return res.status(401).json({ error: 'No autenticado' });
    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .eq('email', req.usuario.email)
      .maybeSingle();
    if (error) throw error;
    console.log('[CLIENTES/ME] OK — found:', !!data);
    res.json(data || null);
  } catch (error) {
    console.error('[CLIENTES/ME] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/clientes/me — update client profile by JWT email
router.put('/me', async (req, res) => {
  try {
    if (!req.usuario?.email) return res.status(401).json({ error: 'No autenticado' });
    const { nombre, telefono, empresa, pronombre } = req.body;
    const updateObj = { nombre, telefono, empresa };
    if (pronombre !== undefined) updateObj.pronombre = pronombre;
    const { data, error } = await supabase
      .from('clientes')
      .update(updateObj)
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
    if (!req.usuario?.email) return res.status(401).json({ error: 'No autenticado' });
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

// GET /api/clientes/me/favoritos
router.get('/me/favoritos', async (req, res) => {
  try {
    if (!req.usuario?.email) return res.status(401).json({ error: 'No autenticado' });
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

async function getOrCreateCliente(usuario) {
  let { data: cliente, error: findErr } = await supabase
    .from('clientes').select('id').eq('email', usuario.email).maybeSingle();
  if (findErr) {
    // maybeSingle throws if multiple rows — try limit(1)
    const { data: rows } = await supabase.from('clientes').select('id').eq('email', usuario.email).limit(1);
    cliente = rows?.[0] || null;
  }
  if (!cliente) {
    const { data: nc, error: ce } = await supabase
      .from('clientes')
      .insert([{ nombre: usuario.nombre || usuario.email, email: usuario.email, tipo: 'Cliente' }])
      .select('id').maybeSingle();
    if (ce && ce.code === '23505') {
      // Duplicate inserted by concurrent request — fetch it
      const { data: ex } = await supabase.from('clientes').select('id').eq('email', usuario.email).limit(1);
      cliente = ex?.[0] || null;
    } else if (ce) {
      throw ce;
    } else {
      cliente = nc;
    }
  }
  if (!cliente?.id) throw new Error('No se pudo obtener el perfil de cliente.');
  return cliente;
}

// POST /api/clientes/me/favoritos  { propiedad_id }
router.post('/me/favoritos', async (req, res) => {
  try {
    const { propiedad_id } = req.body;
    if (!propiedad_id) return res.status(400).json({ error: 'propiedad_id requerido.' });
    const cliente = await getOrCreateCliente(req.usuario);
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
    const cliente = await getOrCreateCliente(req.usuario);
    const { error } = await supabase
      .from('propiedades_favoritas')
      .delete()
      .eq('cliente_id', cliente.id)
      .eq('propiedad_id', req.params.propiedad_id);
    if (error) throw error;
    res.json({ message: 'Favorito eliminado.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN ENDPOINTS — /:id must come AFTER all /me* routes ──────────────────

// GET /api/clientes/:id — single client record (admin)
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('clientes').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { nombre, apellido, email, telefono, empresa, tipo, direccion, zona, ciudad } = req.body;
    const update = { nombre, email, telefono, empresa, tipo };
    if (apellido  !== undefined) update.apellido  = apellido;
    if (direccion !== undefined) update.direccion = direccion;
    if (zona      !== undefined) update.zona      = zona;
    if (ciudad    !== undefined) update.ciudad    = ciudad;
    const { data, error } = await supabase
      .from('clientes')
      .update(update)
      .eq('id', req.params.id)
      .select();
    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE cliente por ID — cascada: borra cotizaciones y confirmaciones relacionadas
router.delete('/:id', async (req, res) => {
  const id = req.params.id;
  try {
    // 1. Cotizaciones del cliente
    await supabase.from('cotizaciones').delete().eq('cliente_id', id);

    // 2. Confirmaciones de registro (portal)
    await supabase.from('confirmaciones_registro').delete().eq('cliente_id', id).then(() => {}).catch(() => {});

    // 3. Borrar el cliente
    const { error } = await supabase.from('clientes').delete().eq('id', id);
    if (error) throw error;

    res.json({ message: 'Cliente y datos relacionados eliminados' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
