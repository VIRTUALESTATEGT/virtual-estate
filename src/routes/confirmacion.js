const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const nodemailer = require('nodemailer');

// ── Email helper ──────────────────────────────────────────────────────────────
function crearTransportador() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host:              process.env.SMTP_HOST,
    port:              Number(process.env.SMTP_PORT) || 587,
    secure:            Number(process.env.SMTP_PORT) === 465,
    auth:              { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    pool:              false,
    connectionTimeout: 40000,
    greetingTimeout:   20000,
    socketTimeout:     60000,
    tls:               { rejectUnauthorized: false },
  });
}

// preDelay: ms to wait before first attempt (lets a prior SMTP session close on Zoho's side)
async function smtpWithRetry(buildMailOpts, label, maxAttempts = 3, preDelay = 0) {
  if (preDelay > 0) {
    console.log(`[${label}] pre-delay ${preDelay}ms — waiting for prior SMTP session to close`);
    await new Promise(r => setTimeout(r, preDelay));
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const transport = crearTransportador();
    if (!transport) throw new Error('SMTP_NOT_CONFIGURED');
    try {
      const mailOpts = buildMailOpts();
      console.log(`[${label}] attempt ${attempt} — sending to: ${mailOpts.to} | html size: ${(mailOpts.html || '').length} bytes`);
      await transport.sendMail(mailOpts);
      transport.close();
      console.log(`[${label}] ✅ sendMail OK (attempt ${attempt})`);
      return;
    } catch (e) {
      transport.close();
      if (attempt === maxAttempts) throw e;
      console.warn(`[${label}] attempt ${attempt} failed: ${e.message} — retry in 6s`);
      await new Promise(r => setTimeout(r, 6000));
    }
  }
}

async function enviarEmailConfirmacion({ email, nombre, apellido, cotizacion_id, monto, anticipo, codigo_cliente, timestamp, detalles_json, moneda }) {
  console.log('[CONFIRM-EMAIL] enviarEmailConfirmacion ▶ destinatario:', email, '| SMTP_HOST set:', !!process.env.SMTP_HOST, '| SMTP_USER set:', !!process.env.SMTP_USER, '| SMTP_PASS set:', !!process.env.SMTP_PASS);
  if (!crearTransportador()) {
    console.error('[CONFIRM-EMAIL] ✗ SMTP no configurado — agrega SMTP_HOST, SMTP_USER y SMTP_PASS en Vercel');
    return;
  }
  const year    = new Date().getFullYear().toString().slice(-2);
  const nroCot  = `COT-${year}-${String(cotizacion_id).padStart(5, '0')}`;
  const fecha   = new Date(timestamp).toLocaleString('es-GT', { dateStyle: 'long', timeStyle: 'short' });
  const nombreCompleto = capitalizarNombre([nombre, apellido].filter(Boolean).join(' ')) || 'Cliente';
  const mon     = moneda || 'USD';
  const factor  = mon === 'GTQ' ? 7.90 : 1;
  const sym     = mon === 'GTQ' ? 'Q' : '$';
  const fmt     = n => sym + ((Number(n) || 0) * factor).toLocaleString('es-GT', { minimumFractionDigits: 2 });
  const det     = detalles_json || {};
  const servicios = det.servicios || [];

  const descMonto = Number(det.descuento_monto || 0);
  const descLabel = det.descuento_tipo === 'porcentaje' ? `Descuento (${det.descuento_valor}%)` : 'Descuento';
  const D = '................................................................................';
  const tRow = (lbl, val, clr, bold, sep) =>
    '<tr>' +
    `<td style="padding:${bold?'8':'4'}px 0;font-family:'Courier New',Courier,monospace;font-size:13px;color:${clr};font-weight:${bold?700:400};white-space:nowrap;${sep?'border-top:1px solid rgba(193,146,89,.18);padding-top:10px;':''}">${lbl}</td>` +
    `<td style="padding:${bold?'8':'4'}px 2px;font-family:monospace;font-size:11px;color:rgba(193,146,89,.22);overflow:hidden;max-width:1px;width:100%;${sep?'border-top:1px solid rgba(193,146,89,.18);':''}">${D}</td>` +
    `<td style="padding:${bold?'8':'4'}px 0 ${bold?'8':'4'}px 4px;font-family:'Courier New',Courier,monospace;font-size:13px;color:${clr};font-weight:${bold?700:400};white-space:nowrap;text-align:right;${sep?'border-top:1px solid rgba(193,146,89,.18);padding-top:10px;':''}">${val}</td>` +
    '</tr>';

  const svcRows = servicios.map((s, i) => {
    const bg       = i % 2 === 0 ? '#0E1615' : '#131f18';
    const cantidad = s.tipo_precio === 'por_m2' ? `${s.cantidad || 0} m²` : s.tipo_precio === 'cotizar' ? 'A cotizar' : '1 ud';
    const unitPrice = s.tipo_precio === 'cotizar' ? '—' : fmt(s.precio_unitario || 0);
    return `<tr style="background:${bg};">
      <td style="padding:8px 10px;font-size:13px;color:#F5F0E8;border-bottom:1px solid rgba(193,146,89,.1);">${s.descripcion || '—'}</td>
      <td style="padding:8px 10px;font-size:13px;color:#8A9990;text-align:center;border-bottom:1px solid rgba(193,146,89,.1);">${cantidad}</td>
      <td style="padding:8px 10px;font-size:13px;color:#8A9990;text-align:right;border-bottom:1px solid rgba(193,146,89,.1);">${unitPrice}</td>
      <td style="padding:8px 10px;font-size:13px;color:#B09A6C;font-weight:600;text-align:right;border-bottom:1px solid rgba(193,146,89,.1);">${fmt(s.subtotal || 0)}</td>
    </tr>`;
  }).join('');

  const totalsHTML = `
    <div style="background:rgba(193,146,89,.04);border:1px solid rgba(193,146,89,.18);border-radius:4px;padding:12px 16px;margin:16px 0;">
      <table style="width:100%;border-collapse:collapse;">
        ${det.subtotal != null ? tRow('Subtotal', fmt(det.subtotal), '#8A9990', false, false) : ''}
        ${descMonto > 0 ? tRow(descLabel, '-' + fmt(descMonto), '#E08080', false, false) : ''}
        ${tRow('IVA 12%', fmt(det.iva_monto || 0), '#8A9990', false, false)}
        ${tRow('TOTAL', fmt(det.total || monto || 0), '#B09A6C', true, true)}
      </table>
    </div>
    ${Number(anticipo) > 0 ? `
    <div style="background:rgba(193,146,89,.08);border:1px solid rgba(193,146,89,.22);border-radius:4px;padding:14px 18px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-size:11px;color:#8A9990;text-transform:uppercase;letter-spacing:.5px;">Anticipo confirmado</div>
        <div style="font-size:22px;font-weight:700;color:#B09A6C;margin-top:3px;">${fmt(anticipo)}</div>
      </div>
      <div style="font-size:11px;color:#8A9990;text-align:right;line-height:1.6;">50% del total<br/>Restante: ${fmt(Math.max(0, (det.total || Number(monto) || 0) - Number(anticipo)))}</div>
    </div>` : ''}`;

  const codesHTML = `
    <div style="text-align:center;margin:20px 0;">
      <div style="margin-bottom:10px;">
        <div style="font-size:10px;color:#8A9990;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Código de Cotización</div>
        <div style="display:inline-block;background:rgba(193,146,89,.12);border:1px solid rgba(193,146,89,.3);border-radius:4px;padding:7px 20px;font-family:'Courier New',Courier,monospace;color:#B09A6C;font-size:14px;letter-spacing:.12em;">${nroCot}</div>
      </div>
      <div>
        <div style="font-size:10px;color:#8A9990;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Código de Cliente</div>
        <div style="display:inline-block;background:rgba(193,146,89,.12);border:1px solid rgba(193,146,89,.3);border-radius:4px;padding:7px 20px;font-family:'Courier New',Courier,monospace;color:#B09A6C;font-size:14px;letter-spacing:.12em;">${codigo_cliente}</div>
      </div>
    </div>`;

  await smtpWithRetry(() => ({
    from: `"Virtual Estate GT" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to: email,
    subject: `✅ Cotización Confirmada ${nroCot} — Virtual Estate GT`,
    html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0D4137;padding:0;">

  <!-- Header -->
  <div style="background:#0D4137;padding:28px 24px;text-align:center;border-bottom:3px solid #B09A6C;">
    <h2 style="color:#B09A6C;margin:0;font-size:15px;letter-spacing:1px;text-transform:uppercase;">Confirmación de Cotización</h2>
  </div>

  <!-- Body -->
  <div style="background:#0E1615;border-left:1px solid rgba(193,146,89,.18);border-right:1px solid rgba(193,146,89,.18);">

    <!-- Saludo -->
    <div style="padding:24px 24px 0;">
      <p style="font-size:18px;font-weight:700;color:#F5F0E8;margin:0 0 6px;">¡Hola ${nombreCompleto}! 🎉</p>
      <p style="font-size:14px;line-height:1.6;color:#8A9990;margin:0 0 4px;">
        Tu cotización <strong style="color:#B09A6C;">${nroCot}</strong> ha sido confirmada exitosamente.
      </p>
      <p style="font-size:12px;color:#8A9990;margin:0 0 20px;">Confirmada el ${fecha}</p>
    </div>

    ${codesHTML}

    ${servicios.length ? `
    <!-- Servicios -->
    <div style="padding:0 24px;">
      <table style="width:100%;border-collapse:collapse;border:1px solid rgba(193,146,89,.18);">
        <thead>
          <tr style="background:#1E3028;">
            <th style="padding:9px 10px;font-size:12px;text-align:left;color:#B09A6C;letter-spacing:.5px;text-transform:uppercase;">Descripción</th>
            <th style="padding:9px 10px;font-size:12px;text-align:center;color:#B09A6C;letter-spacing:.5px;text-transform:uppercase;">Cant.</th>
            <th style="padding:9px 10px;font-size:12px;text-align:right;color:#B09A6C;letter-spacing:.5px;text-transform:uppercase;">P. Unit.</th>
            <th style="padding:9px 10px;font-size:12px;text-align:right;color:#B09A6C;letter-spacing:.5px;text-transform:uppercase;">Subtotal</th>
          </tr>
        </thead>
        <tbody>${svcRows}</tbody>
      </table>
    </div>` : ''}

    <!-- Totales -->
    <div style="padding:0 24px;">${totalsHTML}</div>

    <!-- Próximos pasos -->
    <div style="padding:0 24px 24px;">
      <div style="border-top:1px solid rgba(193,146,89,.15);padding-top:16px;">
        <p style="font-size:12px;font-weight:700;color:#B09A6C;letter-spacing:.06em;text-transform:uppercase;margin:0 0 10px;">Próximos pasos</p>
        <ol style="margin:0;padding-left:18px;color:#8A9990;font-size:13px;line-height:1.8;">
          <li>Realiza el anticipo a los medios de pago indicados por tu asesor.</li>
          <li>Nuestro equipo se contactará contigo en las próximas <strong style="color:#F5F0E8;">24–48 horas</strong>.</li>
          <li>Guarda tus códigos — los necesitarás para futuras referencias.</li>
        </ol>
      </div>
    </div>

    <!-- Portal CTA -->
    <div style="margin:0 24px 28px;background:rgba(193,146,89,.07);border:1px solid rgba(193,146,89,.25);border-radius:6px;padding:20px 22px;">
      <p style="font-size:12px;font-weight:700;color:#B09A6C;letter-spacing:.06em;text-transform:uppercase;margin:0 0 8px;">Tu portal de cliente</p>
      <p style="font-size:13px;color:#8A9990;line-height:1.65;margin:0 0 16px;">
        Crea tu perfil en nuestro portal para dar seguimiento a tus cotizaciones,
        ver el avance de tus proyectos y acceder a tus tours 3D en cualquier momento.
        Al registrarte con <strong style="color:#F5F0E8;">${email}</strong>,
        esta cotización quedará vinculada automáticamente a tu cuenta.
      </p>
      <a href="https://www.virtualestategt.com/portal.html"
         style="display:inline-block;background:#B09A6C;color:#0D1A14;padding:11px 22px;
                border-radius:4px;text-decoration:none;font-weight:700;font-size:13px;
                letter-spacing:.4px;">
        Crear mi perfil →
      </a>
    </div>

  </div>

  <!-- Footer -->
  <div style="background:#0D4137;padding:20px 24px;text-align:center;border-top:1px solid rgba(193,146,89,.2);">
    <p style="font-size:12px;color:rgba(255,255,255,.7);margin:0 0 6px;">¿Tienes preguntas? Escríbenos:</p>
    <p style="font-size:12px;margin:0;">
      <a href="mailto:info@virtualestategt.com" style="color:#B09A6C;text-decoration:none;">info@virtualestategt.com</a>
      &nbsp;·&nbsp;
      <a href="https://wa.me/50239902399" style="color:#B09A6C;text-decoration:none;">+502 3990 2399</a>
    </p>
    <p style="font-size:11px;color:rgba(255,255,255,.4);margin:12px 0 0;">Virtual Estate GT · Guatemala City · virtualestategt.com</p>
  </div>

</div>`,
  }), 'CONFIRM-EMAIL', 3, 15000);
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
      .select('*, clientes(id, nombre, apellido, email), leads(id, nombre, apellido, email, telefono)')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' });
    if (cot.estado_confirmacion === 'confirmado') {
      return res.json({ ya_confirmada: true, cotizacion_id: cot.id, codigo_cliente: cot.clientes?.codigo_cliente || null });
    }

    const nombre   = cot.clientes?.nombre || cot.leads?.nombre || 'Cliente';
    const apellido = cot.clientes?.apellido || cot.leads?.apellido || '';
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
  console.log('[CONFIRM-EMAIL] cliente.email:', cliente.email || '(vacío)', '| cliente.id:', cliente.id, '| codigo_cliente:', codigo_cliente);
  if (cliente.email) {
    enviarEmailConfirmacion({
      email:         cliente.email,
      nombre:        cliente.nombre,
      apellido:      cliente.apellido || null,
      cotizacion_id,
      monto:         cot.monto,
      anticipo:      montoAnticipo,
      codigo_cliente,
      timestamp:     ahora,
      detalles_json: cot.detalles_json || null,
      moneda:        cot.moneda || 'USD',
    }).then(() => {
      console.log('[CONFIRM-EMAIL] ✅ Enviado a:', cliente.email);
    }).catch(e => {
      console.error('[CONFIRM-EMAIL] ✗ FALLÓ para:', cliente.email, '| error:', e.message);
    });
  } else {
    console.warn('[CONFIRM-EMAIL] ✗ Sin email — cliente no tiene dirección registrada');
  }

  return {
    cliente_id:     cliente.id,
    codigo_cliente,
    cotizacion_id,
    monto:          cot.monto,
    anticipo:       montoAnticipo,
  };
}

// ── POST /api/cron/limpiar — called by Vercel cron at 0 6 * * * ──────────────
// Vercel calls /api/cron/limpiar → app.use('/api/cron', router) strips prefix
// → router receives /limpiar → matches this handler. Protected by CRON_SECRET.
router.post('/limpiar', async (req, res) => {
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── Tarea 1: eliminar borradores sin confirmar de más de 3 meses ─────────
  // Requiere migration 036 (ADD COLUMN created_at). Falla silenciosamente hasta
  // que se aplique; Tarea 2 corre igual gracias al try/catch independiente.
  let eliminadas = 0;
  try {
    const hace3meses = new Date();
    hace3meses.setMonth(hace3meses.getMonth() - 3);

    const { data: eliminadasData, error: errElim } = await supabase
      .from('cotizaciones')
      .delete()
      .eq('estado_confirmacion', 'pendiente')
      .lt('created_at', hace3meses.toISOString())
      .select('id');

    if (errElim) throw errElim;
    eliminadas = eliminadasData?.length || 0;
    console.log(`[CRON] Tarea 1 — cotizaciones vencidas eliminadas: ${eliminadas}`);
  } catch (e) {
    console.error('[CRON] Tarea 1 error:', e.message);
  }

  // ── Tarea 2: pasar a 'pendiente' las 'enviadas' sin confirmar en 14 días ─
  let pendientes = 0;
  try {
    const hace14dias = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    // Rama A: tiene fecha_envio_manual y ya pasaron 14 días
    const { data: vencA, error: errA } = await supabase
      .from('cotizaciones')
      .update({ estado: 'pendiente' })
      .eq('estado', 'enviada')
      .neq('estado_confirmacion', 'confirmado')
      .not('fecha_envio_manual', 'is', null)
      .lt('fecha_envio_manual', hace14dias)
      .select('id');
    if (errA) console.error('[CRON] Tarea 2 Rama A error:', errA.message);

    // Rama B: sin fecha_envio_manual — usa created_at (disponible tras migration 036)
    // como ancla temporal; respeta igualmente los 14 días.
    const { data: vencB, error: errB } = await supabase
      .from('cotizaciones')
      .update({ estado: 'pendiente' })
      .eq('estado', 'enviada')
      .neq('estado_confirmacion', 'confirmado')
      .is('fecha_envio_manual', null)
      .lt('created_at', hace14dias)
      .select('id');
    if (errB) console.error('[CRON] Tarea 2 Rama B error:', errB.message);

    pendientes = (vencA?.length || 0) + (vencB?.length || 0);
    console.log(`[CRON] Tarea 2 — cotizaciones enviadas → pendiente: ${pendientes}`);
  } catch (e) {
    console.error('[CRON] Tarea 2 error:', e.message);
  }

  res.json({ success: true, eliminadas, pendientes });
});

module.exports = router;
