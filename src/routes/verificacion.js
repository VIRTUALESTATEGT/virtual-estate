const express  = require('express');
const router   = express.Router();
const supabase = require('../config/supabase');
const { notifyAdmin } = require('../utils/whatsapp');

// POST /api/cliente/verificacion-identidad — client submits docs
router.post('/', async (req, res) => {
  try {
    const { dpi_numero, dpi_imagen_url, documento_foto_url, selfie_vivo_url } = req.body;
    if (!dpi_numero) return res.status(400).json({ error: 'DPI requerido' });

    // Find client by JWT email
    const { data: cliente } = await supabase
      .from('clientes').select('id, nombre, email').eq('email', req.usuario.email).maybeSingle();
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

    // Upsert — one pending verification per client at a time
    const { data, error } = await supabase
      .from('cliente_verificacion_identidad')
      .upsert([{
        cliente_id: cliente.id,
        estado: 'pendiente',
        dpi_numero,
        dpi_imagen_url: dpi_imagen_url || null,
        documento_foto_url: documento_foto_url || null,
        selfie_vivo_url: selfie_vivo_url || null,
        timestamp_captura: new Date().toISOString(),
        verificacion_biometrica: false,
        razon_rechazo: null,
      }], { onConflict: 'cliente_id' })
      .select().single();
    if (error) throw error;

    // Save notification
    await supabase.from('notificaciones_admin').insert([{
      tipo: 'verificacion_pendiente',
      referencia_id: cliente.id,
      contenido: `[VERIFICACIÓN] Cliente ${cliente.nombre} (${cliente.email}) subió documentos. DPI: ${dpi_numero}`,
    }]);

    // WhatsApp notify admin
    await notifyAdmin(
      `📋 *VERIFICACIÓN PENDIENTE*\n` +
      `Cliente: ${cliente.nombre}\n` +
      `Email: ${cliente.email}\n` +
      `DPI: ${dpi_numero}\n\n` +
      `Responde: APROBAR ${cliente.id} o RECHAZAR ${cliente.id}: [motivo]`
    );

    res.status(201).json({ message: 'Documentos recibidos. Revisión en proceso.', id: data.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/cliente/verificacion-identidad/estado — client checks own status
router.get('/estado', async (req, res) => {
  try {
    const { data: cliente } = await supabase
      .from('clientes').select('id').eq('email', req.usuario.email).maybeSingle();
    if (!cliente) return res.json(null);
    const { data, error } = await supabase
      .from('cliente_verificacion_identidad')
      .select('id, estado, razon_rechazo, timestamp_captura')
      .eq('cliente_id', cliente.id)
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle();
    if (error) throw error;
    res.json(data || null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/verificaciones — admin list pending verifications
router.get('/admin/lista', async (req, res) => {
  try {
    const { estado = 'pendiente' } = req.query;
    const { data, error } = await supabase
      .from('cliente_verificacion_identidad')
      .select('*, clientes(nombre, email, telefono)')
      .eq('estado', estado)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/procesar-verificacion
router.post('/admin/procesar', async (req, res) => {
  try {
    const { cliente_id, accion, razon_rechazo } = req.body;
    if (!cliente_id || !accion) return res.status(400).json({ error: 'cliente_id y accion requeridos' });
    if (!['aprobar', 'rechazar'].includes(accion)) return res.status(400).json({ error: 'accion debe ser aprobar o rechazar' });

    const nuevoEstado = accion === 'aprobar' ? 'verificado' : 'rechazado';
    const update = { estado: nuevoEstado, revisor_id: req.usuario.id };
    if (accion === 'rechazar' && razon_rechazo) update.razon_rechazo = razon_rechazo;
    if (accion === 'aprobar') update.verificacion_biometrica = true;

    const { data, error } = await supabase
      .from('cliente_verificacion_identidad')
      .update(update)
      .eq('cliente_id', cliente_id)
      .select().maybeSingle();
    if (error) throw error;

    // Update notification
    await supabase.from('notificaciones_admin')
      .update({ estado: 'respondida', respuesta_admin: accion, timestamp_respuesta: new Date().toISOString() })
      .eq('tipo', 'verificacion_pendiente').eq('referencia_id', cliente_id).eq('estado', 'enviada');

    res.json({ message: `Verificación ${nuevoEstado}`, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
