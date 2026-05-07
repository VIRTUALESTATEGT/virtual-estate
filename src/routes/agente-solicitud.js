const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// POST /api/agente/solicitud  — portal client submits agent application
router.post('/solicitud', async (req, res) => {
  try {
    const u = req.usuario;
    const {
      banco, tipo_cuenta, cuenta_bancaria, titular_cuenta,
      tipo_referido, notas,
      dpi_frente, dpi_reverso, selfie,
      acepta_terminos, firma_electronica
    } = req.body;

    if (!banco || !cuenta_bancaria || !titular_cuenta)
      return res.status(400).json({ error: 'Datos bancarios incompletos.' });
    if (!dpi_frente)
      return res.status(400).json({ error: 'Foto del DPI (frente) requerida.' });
    if (!selfie)
      return res.status(400).json({ error: 'Selfie en vivo requerida.' });
    if (!acepta_terminos)
      return res.status(400).json({ error: 'Debes aceptar los términos del acuerdo.' });
    if (!firma_electronica || firma_electronica.trim().length < 3)
      return res.status(400).json({ error: 'La firma electrónica (nombre completo) es obligatoria.' });

    // Find or create clientes record
    let { data: cliente } = await supabase
      .from('clientes').select('id').eq('email', u.email).maybeSingle();
    if (!cliente) {
      const { data: nc, error: ce } = await supabase
        .from('clientes')
        .insert([{ nombre: u.nombre, email: u.email, tipo: 'Cliente' }])
        .select('id').single();
      if (ce) throw ce;
      cliente = nc;
    }

    // Check for duplicate pending/approved request
    const { data: existing } = await supabase
      .from('solicitudes_agente')
      .select('id, estado')
      .eq('cliente_id', cliente.id)
      .in('estado', ['pendiente', 'aprobado'])
      .maybeSingle();
    if (existing)
      return res.status(409).json({ error: existing.estado === 'aprobado' ? 'Ya tienes un código de agente activo.' : 'Ya tienes una solicitud pendiente de revisión.' });

    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;

    const { data, error } = await supabase
      .from('solicitudes_agente')
      .insert([{
        cliente_id: cliente.id,
        nombre: u.nombre,
        email: u.email,
        banco, tipo_cuenta, cuenta_bancaria, titular_cuenta,
        tipo_referido: tipo_referido || null,
        notas: notas || null,
        dpi_frente, dpi_reverso: dpi_reverso || null, selfie,
        acepta_terminos: true,
        firma_electronica: firma_electronica.trim(),
        ip_registro: ip,
        estado: 'pendiente'
      }])
      .select('id, estado, created_at')
      .single();
    if (error) throw error;

    res.status(201).json({ message: 'Solicitud enviada. Te notificaremos en 1-2 días hábiles.', solicitud: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/agente/solicitud/mi-solicitud — portal client checks own status
router.get('/solicitud/mi-solicitud', async (req, res) => {
  try {
    const { data: cliente } = await supabase
      .from('clientes').select('id').eq('email', req.usuario.email).maybeSingle();
    if (!cliente) return res.json(null);
    const { data, error } = await supabase
      .from('solicitudes_agente')
      .select('id, estado, codigo_asignado, notas_admin, created_at')
      .eq('cliente_id', cliente.id)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    res.json(data || null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN ENDPOINTS (requireMinRole('gerente') applied in server.js) ─────────

// GET /api/agente/solicitudes — list all applications (admin)
router.get('/solicitudes', async (req, res) => {
  try {
    const { estado } = req.query;
    let q = supabase
      .from('solicitudes_agente')
      .select('id, nombre, email, banco, tipo_cuenta, cuenta_bancaria, titular_cuenta, tipo_referido, estado, codigo_asignado, firma_electronica, acepta_terminos, created_at, notas_admin, notas')
      .order('id', { ascending: false });
    if (estado) q = q.eq('estado', estado);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/agente/solicitudes/:id/imagenes — get images for one application (admin)
router.get('/solicitudes/:id/imagenes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('solicitudes_agente')
      .select('id, dpi_frente, dpi_reverso, selfie')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/agente/solicitudes/:id — approve or reject (admin)
router.put('/solicitudes/:id', async (req, res) => {
  try {
    const { estado, notas_admin } = req.body;
    if (!['aprobado', 'rechazado'].includes(estado))
      return res.status(400).json({ error: 'estado debe ser aprobado o rechazado.' });

    let updateData = { estado, notas_admin: notas_admin || null, updated_at: new Date().toISOString() };

    if (estado === 'aprobado') {
      // Generate unique agent code: AGT-YY-XXXXX
      const year = String(new Date().getFullYear()).slice(-2);
      const { count } = await supabase
        .from('solicitudes_agente').select('id', { count: 'exact', head: true }).eq('estado', 'aprobado');
      const seq = String((count || 0) + 1).padStart(5, '0');
      updateData.codigo_asignado = `AGT-${year}-${seq}`;

      // Also store code on clientes record
      const { data: sol } = await supabase
        .from('solicitudes_agente').select('cliente_id').eq('id', req.params.id).single();
      if (sol?.cliente_id) {
        await supabase.from('clientes')
          .update({ codigo_agente: updateData.codigo_asignado })
          .eq('id', sol.cliente_id);
      }
    }

    const { data, error } = await supabase
      .from('solicitudes_agente')
      .update(updateData)
      .eq('id', req.params.id)
      .select('id, estado, codigo_asignado, notas_admin')
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
