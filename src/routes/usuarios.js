const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const verificarPermiso = require('../middleware/permisos');
const { hashPassword } = require('../utils/passwords');

const PERMISOS_LISTA = [
  'ver_propiedades','crear_propiedad','editar_propiedad','eliminar_propiedad','publicar_propiedad',
  'ver_cotizaciones','crear_cotizacion','editar_cotizacion','cambiar_estado_cotizacion','eliminar_cotizacion',
  'ver_clientes','crear_cliente','editar_cliente','eliminar_cliente',
  'ver_usuarios','crear_usuario','editar_usuario','eliminar_usuario',
  'ver_agentes','crear_agente','editar_agente','eliminar_agente',
  'ver_reportes','exportar_datos','ver_logs','cambiar_configuracion',
];

// GET / — list all users
router.get('/', verificarPermiso('ver_usuarios'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, nombre, email, role, is_superadmin, estado')
      .order('id', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /permisos-lista — return all permission keys
router.get('/permisos-lista', (req, res) => {
  res.json(PERMISOS_LISTA);
});

// GET /:id/permisos — get permission map for a user
router.get('/:id/permisos', verificarPermiso('ver_usuarios'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('permisos_usuario')
      .select('permiso, valor')
      .eq('usuario_id', req.params.id);
    if (error) throw error;
    const map = {};
    PERMISOS_LISTA.forEach(p => { map[p] = false; });
    (data || []).forEach(r => { map[r.permiso] = r.valor; });
    res.json(map);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST / — create user with role + initial permissions
router.post('/', verificarPermiso('crear_usuario'), async (req, res) => {
  try {
    const { nombre, email, password, role, permisos } = req.body;
    if (!nombre || !email || !password)
      return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos.' });
    const hashed = await hashPassword(password);
    const { data: user, error: ue } = await supabase
      .from('usuarios')
      .insert([{ nombre, email, password: hashed, role: role || 'asistente', estado: 'activo', is_superadmin: false }])
      .select('id, nombre, email, role, is_superadmin, estado')
      .single();
    if (ue) throw ue;
    if (permisos && Object.keys(permisos).length) {
      const rows = Object.entries(permisos)
        .map(([permiso, valor]) => ({ usuario_id: user.id, permiso, valor: Boolean(valor) }));
      await supabase.from('permisos_usuario').insert(rows);
    }
    res.status(201).json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /:id — update user role/estado
router.put('/:id', verificarPermiso('editar_usuario'), async (req, res) => {
  try {
    const { nombre, role, estado } = req.body;
    const update = {};
    if (nombre !== undefined) update.nombre = nombre;
    if (role !== undefined) update.role = role;
    if (estado !== undefined) update.estado = estado;
    const { data, error } = await supabase
      .from('usuarios')
      .update(update)
      .eq('id', req.params.id)
      .select('id, nombre, email, role, is_superadmin, estado')
      .maybeSingle();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /:id — delete user (cannot delete superadmin)
router.delete('/:id', verificarPermiso('eliminar_usuario'), async (req, res) => {
  try {
    const { data: target } = await supabase
      .from('usuarios')
      .select('is_superadmin')
      .eq('id', req.params.id)
      .maybeSingle();
    if (target?.is_superadmin) {
      return res.status(403).json({ error: 'No se puede eliminar al superadmin.' });
    }
    const { error } = await supabase.from('usuarios').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Usuario eliminado' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /asignar-permisos — bulk upsert permissions (superadmin only)
router.post('/asignar-permisos', async (req, res) => {
  if (!req.usuario.is_superadmin)
    return res.status(403).json({ error: 'Solo el superadmin puede asignar permisos.' });
  try {
    const { usuario_id, permisos } = req.body;
    if (!usuario_id || !permisos)
      return res.status(400).json({ error: 'usuario_id y permisos son requeridos.' });
    const rows = Object.entries(permisos)
      .map(([permiso, valor]) => ({ usuario_id: Number(usuario_id), permiso, valor: Boolean(valor) }));
    const { error } = await supabase
      .from('permisos_usuario')
      .upsert(rows, { onConflict: 'usuario_id,permiso' });
    if (error) throw error;
    res.json({ message: 'Permisos actualizados correctamente.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router, PERMISOS_LISTA };
