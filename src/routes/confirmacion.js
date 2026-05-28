const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const nodemailer = require('nodemailer');

// ── Email helper ──────────────────────────────────────────────────────────────
function crearTransportador() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function enviarEmailConfirmacion({ email, nombre, cotizacion_id, monto, anticipo, codigo_cliente, timestamp }) {
  const transport = crearTransportador();
  if (!transport) {
    console.log('[EMAIL] SMTP no configurado — email de confirmación omitido');
    return;
  }
  const year  = new Date().getFullYear().toString().slice(-2);
  const nroCot = `COT-${year}-${String(cotizacion_id).padStart(5, '0')}`;
  const fecha  = new Date(timestamp).toLocaleString('es-GT', { dateStyle: 'long', timeStyle: 'short' });
  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: `Cotización Confirmada ${nroCot} — Virtual Estate GT`,
    text: `
Hola ${nombre},

Gracias por confirmar tu cotización.

DETALLES DE CONFIRMACIÓN
─────────────────────────
Número de cotización : ${nroCot}
Monto total          : Q${Number(monto).toLocaleString('es-GT', { minimumFractionDigits: 2 })}
Anticipo confirmado  : Q${Number(anticipo).toLocaleString('es-GT', { minimumFractionDigits: 2 })}
Código de cliente    : ${codigo_cliente}
Fecha confirmación   : ${fecha}

Tu código de cliente es: ${codigo_cliente}
Úsalo para futuras referencias y en tu portal.

PRÓXIMOS PASOS
─────────────────────────
1. Realiza el anticipo a los medios de pago indicados por tu asesor.
2. Nuestro equipo se contactará contigo en las próximas 24–48 horas.
3. Accede a tu portal en: https://virtualestategt.com/portal.html

Saludos,
Virtual Estate GT
https://virtualestategt.com
`.trim(),
  });
  console.log(`[EMAIL] Confirmación enviada a ${email}`);
}

// ── Capitalizar texto (cada palabra con mayúscula inicial) ────────────────────
function capitalizarNombre(str) {
  if (!str) return null;
  return String(str).toLowerCase().trim()
    .split(/\s+/)
    .map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : '')
    .join(' ') || null;
}

// ── Generar código de cliente (atómico vía Postgres function) ─────────────────
async function generarCodigoCliente() {
  const { data: numero, error } = await supabase.rpc('incrementar_secuencia_cliente');
  if (error) throw new Error('Error generando código de cliente: ' + error.message);
  const year = new Date().getFullYear();
  return `CLI-${year}-${String(numero).padStart(5, '0')}`;
}

// ── GET /api/confirmacion/cotizacion/:id ──────────────────────────────────────
// Devuelve datos de cotización para el portal de confirmación (público)
router.get('/cotizacion/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: cot, error } = await supabase
      .from('cotizaciones')
      .select('*, clientes(id, nombre, email), leads(id, nombre, apellido, email, telefono)')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' });
    if (cot.estado_confirmacion === 'confirmado') {
      return res.json({ ya_confirmada: true, cotizacion_id: cot.id, codigo_cliente: cot.clientes?.codigo_cliente || null });
    }

    const nombre   = cot.clientes?.nombre || cot.leads?.nombre || 'Cliente';
    const apellido = cot.leads?.apellido || '';
    const cliente_nombre = apellido ? `${nombre} ${apellido}` : nombre;
    const anticipo_monto = cot.anticipo || Math.round((Number(cot.monto) * 0.5) * 100) / 100;

    res.json({
      cotizacion_id:       cot.id,
      cliente_nombre,
      monto_total:         Number(cot.monto) || 0,
      anticipo_porcentaje: 50,
      anticipo_monto,
      moneda:              cot.moneda || 'USD',
      tipo_servicio:       cot.tipo_servicio || null,
      canal:               cot.canal || null,
      detalles_json:       cot.detalles_json || {},
      estado:              cot.estado,
      estado_confirmacion: cot.estado_confirmacion,
      requiere_confirmacion: cot.estado_confirmacion !== 'confirmado',
      created_at:          cot.created_at,
    });
  } catch (e) {
    console.error('[CONF GET]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/confirmacion/cotizacion/confirmar ───────────────────────────────
// Confirmación directa desde CRM/admin
router.post('/cotizacion/confirmar', async (req, res) => {
  try {
    const { cotizacion_id, lead_id, anticipo_confirmado, ip, version_terminos = '1.0',
            servicios_json, tamano_propiedad_m2, zona, ubicacion_completa, user_agent } = req.body;
    if (!cotizacion_id) return res.status(400).json({ error: 'cotizacion_id requerido' });
    const resultado = await procesarConfirmacion({
      cotizacion_id, lead_id, anticipo_confirmado, ip, version_terminos,
      servicios_json, tamano_propiedad_m2, zona, ubicacion_completa, user_agent,
    });
    res.json(resultado);
  } catch (e) {
    console.error('[CONF POST]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/confirmacion/lead/:id/terminos ──────────────────────────────────
// Llamado desde el portal web del cliente
router.post('/lead/:id/terminos', async (req, res) => {
  try {
    const lead_id = Number(req.params.id);
    const { cotizacion_id, anticipo_confirmado, ip, version_terminos = '1.0',
            servicios_json, tamano_propiedad_m2, zona, ubicacion_completa, user_agent } = req.body;
    if (!cotizacion_id) return res.status(400).json({ error: 'cotizacion_id requerido' });
    const resultado = await procesarConfirmacion({
      cotizacion_id, lead_id, anticipo_confirmado, ip, version_terminos,
      servicios_json, tamano_propiedad_m2, zona, ubicacion_completa, user_agent,
    });
    res.json({ success: true, ...resultado, mensaje: 'Confirmación registrada. Te enviaremos email de confirmación.' });
  } catch (e) {
    console.error('[CONF TERMINOS]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Core confirmation logic ───────────────────────────────────────────────────
async function procesarConfirmacion({ cotizacion_id, lead_id, anticipo_confirmado, ip, version_terminos,
  servicios_json, tamano_propiedad_m2, zona, ubicacion_completa, user_agent }) {
  // 1. Load cotizacion
  const { data: cot, error: cotErr } = await supabase
    .from('cotizaciones')
    .select('*')
    .eq('id', cotizacion_id)
    .maybeSingle();
  if (cotErr) throw cotErr;
  if (!cot) throw new Error('Cotización no encontrada');
  if (cot.estado_confirmacion === 'confirmado') throw new Error('Esta cotización ya fue confirmada');

  // 2. Resolve lead (from param or from cotizacion)
  const resolvedLeadId = lead_id || cot.lead_id || null;
  let lead = null;
  if (resolvedLeadId) {
    const { data } = await supabase.from('leads').select('*').eq('id', resolvedLeadId).maybeSingle();
    lead = data;
  }

  // 3. Find or create cliente
  let cliente = null;
  let codigo_cliente = null;
  const emailBuscar = lead?.email || null;

  if (emailBuscar) {
    const { data: existente } = await supabase
      .from('clientes').select('*').eq('email', emailBuscar).maybeSingle();
    cliente = existente;
  } else if (cot.cliente_id) {
    const { data: existente } = await supabase
      .from('clientes').select('*').eq('id', cot.cliente_id).maybeSingle();
    cliente = existente;
  }

  const ahora = new Date().toISOString();

  if (!cliente) {
    // Create new cliente copying all lead data (capitalized)
    codigo_cliente = await generarCodigoCliente();
    const { data: nuevoCliente, error: ceErr } = await supabase
      .from('clientes')
      .insert([{
        nombre:                         capitalizarNombre(lead?.nombre) || 'Cliente',
        apellido:                       capitalizarNombre(lead?.apellido) || null,
        email:                          lead?.email  || null,
        telefono:                       lead?.telefono || null,
        empresa:                        capitalizarNombre(lead?.empresa) || null,
        tipo:                           'Cliente',
        codigo_cliente,
        confirmacion_timestamp:         ahora,
        confirmacion_ip:                ip || null,
        confirmacion_version_terminos:  version_terminos,
      }])
      .select().single();
    if (ceErr) throw ceErr;
    cliente = nuevoCliente;
  } else {
    // Update existing cliente: sync lead data + assign code
    if (!cliente.codigo_cliente) codigo_cliente = await generarCodigoCliente();
    else codigo_cliente = cliente.codigo_cliente;

    const updateFields = {
      nombre:                        capitalizarNombre(lead?.nombre) || cliente.nombre,
      apellido:                      capitalizarNombre(lead?.apellido) ?? cliente.apellido ?? null,
      empresa:                       capitalizarNombre(lead?.empresa) ?? cliente.empresa ?? null,
      confirmacion_timestamp:        ahora,
      confirmacion_ip:               ip || null,
      confirmacion_version_terminos: version_terminos,
      codigo_cliente,
    };
    if (lead?.telefono && !cliente.telefono) updateFields.telefono = lead.telefono;

    const { data: clienteActualizado } = await supabase
      .from('clientes').update(updateFields).eq('id', cliente.id).select().single();
    cliente = clienteActualizado || cliente;
  }

  const montoAnticipo = anticipo_confirmado ?? cot.anticipo ?? Math.round(Number(cot.monto) * 0.5);

  // 4. Update cotizacion
  await supabase.from('cotizaciones').update({
    estado:               'confirmada',
    estado_confirmacion:  'confirmado',
    anticipo_confirmado:  montoAnticipo,
    fecha_confirmacion:   ahora,
    ip_confirmacion:      ip || null,
    cliente_id:           cliente.id,
    lead_id:              resolvedLeadId,
  }).eq('id', cotizacion_id);

  // 5. Audit record (before lead deletion to avoid FK violation on lead_id)
  await supabase.from('confirmaciones_registro').insert([{
    cotizacion_id,
    lead_id:              resolvedLeadId,
    cliente_id:           cliente.id,
    monto:                montoAnticipo,
    ip:                   ip || null,
    version_terminos,
    servicios_json:       servicios_json || null,
    tamano_propiedad_m2:  tamano_propiedad_m2 || null,
    zona:                 zona || null,
    ubicacion_completa:   ubicacion_completa || null,
    user_agent:           user_agent || null,
    fecha_confirmacion:   new Date().toISOString(),
  }]);

  // 6. Delete lead — FK constraints (clientes.lead_id, cotizaciones.lead_id) are
  //    ON DELETE SET NULL after migration 025, so Postgres handles nullification.
  //    Fallback: null refs manually if migration not yet applied.
  if (resolvedLeadId) {
    const { error: delErr } = await supabase.from('leads').delete().eq('id', resolvedLeadId);
    if (delErr) {
      console.warn('[CONF] lead delete FK error, nulling refs first:', delErr.message);
      await supabase.from('cotizaciones').update({ lead_id: null }).eq('lead_id', resolvedLeadId);
      await supabase.from('clientes').update({ lead_id: null }).eq('lead_id', resolvedLeadId);
      await supabase.from('leads').delete().eq('id', resolvedLeadId);
    }
  }

  // 7. Send confirmation email (non-blocking)
  if (cliente.email) {
    enviarEmailConfirmacion({
      email:        cliente.email,
      nombre:       cliente.nombre,
      cotizacion_id,
      monto:        cot.monto,
      anticipo:     montoAnticipo,
      codigo_cliente,
      timestamp:    ahora,
    }).catch(e => console.error('[EMAIL ERROR]', e.message));
  }

  return {
    cliente_id:     cliente.id,
    codigo_cliente,
    cotizacion_id,
    monto:          cot.monto,
    anticipo:       montoAnticipo,
  };
}

// ── POST /api/cron/limpiar-cotizaciones ───────────────────────────────────────
// Called by Vercel cron — protected by CRON_SECRET header
router.post('/cron/limpiar', async (req, res) => {
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const hace3meses = new Date();
    hace3meses.setMonth(hace3meses.getMonth() - 3);

    const { data, error } = await supabase
      .from('cotizaciones')
      .delete()
      .eq('estado_confirmacion', 'pendiente')
      .lt('created_at', hace3meses.toISOString())
      .select('id');

    if (error) throw error;
    const eliminadas = data?.length || 0;
    console.log(`[CRON] Cotizaciones vencidas eliminadas: ${eliminadas}`);
    res.json({ success: true, eliminadas });
  } catch (e) {
    console.error('[CRON]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
