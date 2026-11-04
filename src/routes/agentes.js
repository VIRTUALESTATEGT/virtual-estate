'use strict';
const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// ── helpers ───────────────────────────────────────────────────────────────────

function _uniqueError(e) {
  if (e.code !== '23505') return null;
  const msg = e.message || '';
  if (msg.includes('codigo'))
    return { status: 409, error: 'Ese código ya existe' };
  if (msg.includes('usuario_id') || msg.includes('uq_agentes_usuario_id'))
    return { status: 409, error: 'Ese usuario ya está vinculado a otro agente' };
  return { status: 409, error: 'Valor duplicado' };
}

async function _generarCodigo() {
  const { data } = await supabase.from('agentes').select('codigo').like('codigo', 'AGT-%');
  let next = 1;
  if (data?.length) {
    const nums = data.map(r => parseInt((r.codigo || '').replace('AGT-', '')) || 0);
    next = Math.max(...nums) + 1;
  }
  return `AGT-${String(next).padStart(3, '0')}`;
}

async function _validateUsuarioPortal(usuario_id) {
  if (usuario_id == null) return null;
  const { data } = await supabase
    .from('usuarios').select('id, role, estado').eq('id', usuario_id).maybeSingle();
  if (!data) return 'Usuario no encontrado';
  if (data.role !== 'cliente') return 'El usuario no tiene rol de cliente (portal)';
  return null;
}

// ── routes ────────────────────────────────────────────────────────────────────

// GET /api/agentes/usuarios-portal — BEFORE /:id
// Returns usuarios with role='cliente' and estado='activo', with linked agente_id (or null).
router.get('/usuarios-portal', async (req, res) => {
  try {
    const { data: usuarios, error } = await supabase
      .from('usuarios')
      .select('id, nombre, email')
      .eq('role', 'cliente')
      .eq('estado', 'activo')
      .order('nombre');
    if (error) throw error;

    const { data: vinculados } = await supabase
      .from('agentes').select('id, usuario_id').not('usuario_id', 'is', null);

    const mapaAgente = {};
    for (const a of (vinculados || [])) mapaAgente[a.usuario_id] = a.id;

    res.json((usuarios || []).map(u => ({
      id: u.id, nombre: u.nombre, email: u.email,
      agente_id: mapaAgente[u.id] ?? null,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/agentes/:id/resumen — totals by estado+moneda for one agent
router.get('/:id/resumen', async (req, res) => {
  try {
    const { data: rows, error } = await supabase
      .from('comisiones')
      .select('estado, moneda, monto_comision')
      .eq('agente_id', req.params.id);
    if (error) throw error;

    const agg = {};
    for (const r of (rows || [])) {
      const k = r.estado + '.' + r.moneda;
      if (!agg[k]) agg[k] = { estado: r.estado, moneda: r.moneda, count: 0, total: 0 };
      agg[k].count++;
      agg[k].total += Number(r.monto_comision || 0);
    }
    res.json(Object.values(agg));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/agentes
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('agentes').select('*').order('id', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/agentes
router.post('/', async (req, res) => {
  try {
    const { nombre, email, comision, estado, usuario_id } = req.body;
    let { codigo } = req.body;

    if (comision != null && (Number(comision) < 0 || Number(comision) > 100))
      return res.status(400).json({ error: 'La comisión debe estar entre 0 y 100' });

    const uErr = await _validateUsuarioPortal(usuario_id != null ? usuario_id : null);
    if (uErr) return res.status(400).json({ error: uErr });

    if (!codigo) {
      codigo = await _generarCodigo();
    } else {
      codigo = String(codigo).trim().toUpperCase();
    }

    const insert = {
      nombre, email,
      comision: comision != null ? Number(comision) : null,
      estado: estado || 'Activo',
      codigo,
      usuario_id: usuario_id != null ? Number(usuario_id) : null,
    };

    const { data, error } = await supabase.from('agentes').insert([insert]).select();
    if (error) {
      if (error.code === '23505' && (error.message || '').includes('codigo')) {
        // Collision on auto-generated code — retry once
        insert.codigo = await _generarCodigo();
        const { data: data2, error: err2 } = await supabase.from('agentes').insert([insert]).select();
        if (err2) {
          const uniq = _uniqueError(err2);
          if (uniq) return res.status(uniq.status).json({ error: uniq.error });
          throw err2;
        }
        return res.status(201).json(data2[0]);
      }
      const uniq = _uniqueError(error);
      if (uniq) return res.status(uniq.status).json({ error: uniq.error });
      throw error;
    }
    res.status(201).json(data[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/agentes/:id
router.put('/:id', async (req, res) => {
  try {
    const { nombre, email, comision, estado, usuario_id, codigo } = req.body;

    if (comision !== undefined && comision != null && (Number(comision) < 0 || Number(comision) > 100))
      return res.status(400).json({ error: 'La comisión debe estar entre 0 y 100' });

    if (usuario_id !== undefined) {
      const uErr = await _validateUsuarioPortal(usuario_id);
      if (uErr) return res.status(400).json({ error: uErr });
    }

    const update = {};
    if (nombre     !== undefined) update.nombre     = nombre;
    if (email      !== undefined) update.email      = email;
    if (comision   !== undefined) update.comision   = comision != null ? Number(comision) : null;
    if (estado     !== undefined) update.estado     = estado;
    if (usuario_id !== undefined) update.usuario_id = usuario_id != null ? Number(usuario_id) : null;
    if (codigo === null) update.codigo = null;
    else if (codigo !== undefined && String(codigo).trim() !== '') update.codigo = String(codigo).trim().toUpperCase();

    if (Object.keys(update).length === 0)
      return res.status(400).json({ error: 'Nada que actualizar' });

    const { data, error } = await supabase
      .from('agentes').update(update).eq('id', req.params.id).select();
    if (error) {
      const uniq = _uniqueError(error);
      if (uniq) return res.status(uniq.status).json({ error: uniq.error });
      throw error;
    }
    res.json(data[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('agentes').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Agente eliminado' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
