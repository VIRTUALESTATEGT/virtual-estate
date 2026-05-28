const express  = require('express');
const router   = express.Router();
const supabase = require('../config/supabase');
const { sendWhatsAppMessage, sendWhatsAppDocument } = require('../utils/whatsapp');
const { cotCode, generarCotizacionPDF, subirPDFSupabase } = require('../utils/pdf');

async function markEnviado(cotizacionId, metodo) {
  await supabase.from('cotizaciones').update({
    metodo_envio_manual: metodo,
    fecha_envio_manual:  new Date().toISOString(),
    estado_envio:        'enviado',
  }).eq('id', cotizacionId);
}

async function markError(cotizacionId, metodo) {
  await supabase.from('cotizaciones').update({
    metodo_envio_manual: metodo,
    estado_envio:        'error',
  }).eq('id', cotizacionId);
}

// Fetch full cotización row (with joins)
async function fetchCot(cotizacionId) {
  const { data } = await supabase
    .from('cotizaciones')
    .select('*, clientes(nombre, empresa, email, telefono), leads(nombre, apellido, email, telefono)')
    .eq('id', cotizacionId)
    .maybeSingle();
  return data;
}

// ── POST /api/whatsapp/enviar-cotizacion ──────────────────────────────────────
router.post('/whatsapp/enviar-cotizacion', async (req, res) => {
  const { phone_number, cotizacion_id, link } = req.body;

  // ── Credentials check ──────────────────────────────────────────────────────
  const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN;
  console.log('[WA-COT] ▶ cotizacion_id:', cotizacion_id, '| PHONE_ID set:', !!PHONE_ID, '| TOKEN set:', !!TOKEN);

  if (!PHONE_ID || !TOKEN) {
    console.error('[WA-COT] ✗ credentials missing');
    return res.status(503).json({ error: 'WhatsApp no configurado. Agrega WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN en Vercel.' });
  }
  if (!phone_number || !cotizacion_id) {
    return res.status(400).json({ error: 'phone_number y cotizacion_id son requeridos' });
  }

  // ── Phone format check ─────────────────────────────────────────────────────
  const phoneCleaned = String(phone_number).replace(/\D/g, '');
  console.log('[WA-COT] phone raw:', phone_number, '→ cleaned:', phoneCleaned,
    '| length:', phoneCleaned.length,
    '| has country code (≥10 digits):', phoneCleaned.length >= 10);
  if (phoneCleaned.length < 8) {
    return res.status(400).json({ error: `Número inválido: "${phone_number}". Usa formato +502XXXXXXXX.` });
  }

  try {
    const codigo = cotCode(cotizacion_id);
    const cot    = await fetchCot(cotizacion_id);
    console.log('[WA-COT] cot found:', !!cot, '| documento_url:', cot?.documento_url?.slice(0,80) || 'none');

    let pdfSent = false;
    if (cot) {
      try {
        let pdfUrl = cot.documento_url;
        if (!pdfUrl) {
          console.log('[WA-COT] no documento_url — generating PDF on-the-fly...');
          const pdfBuf = await generarCotizacionPDF(cot);
          pdfUrl = await subirPDFSupabase(pdfBuf, `${codigo}.pdf`);
          await supabase.from('cotizaciones').update({ documento_url: pdfUrl }).eq('id', cotizacion_id);
          console.log('[WA-COT] PDF generated & uploaded:', pdfUrl?.slice(0,80));
        }
        console.log('[WA-COT] sending document → phone:', phoneCleaned, '| url:', pdfUrl?.slice(0,80));
        const docResult = await sendWhatsAppDocument(phoneCleaned, pdfUrl, `${codigo}.pdf`);
        pdfSent = !!docResult;
        console.log('[WA-COT] document result:', JSON.stringify(docResult)?.slice(0,120));
      } catch (pdfErr) {
        console.error('[WA-COT] document send failed:', pdfErr.message);
      }
    }

    const textMsg = pdfSent
      ? `Aquí tu cotización formal *${codigo}*. 👆\n\n✅ Para confirmar y revisar detalles, accede aquí:\n${link}`
      : `Hola 👋 Te enviamos tu cotización *${codigo}* de Virtual Estate GT.\n\n📋 Revisa y confirma aquí:\n${link}\n\n¿Tienes alguna pregunta? Responde este mensaje.`;

    console.log('[WA-COT] sending text → phone:', phoneCleaned);
    const result = await sendWhatsAppMessage(phoneCleaned, textMsg);
    console.log('[WA-COT] text result:', JSON.stringify(result)?.slice(0,120));
    if (!result) throw new Error('WHATSAPP_NOT_CONFIGURED');

    await markEnviado(cotizacion_id, 'whatsapp');
    res.json({ ok: true, canal: 'whatsapp', pdf_sent: pdfSent });
  } catch (e) {
    console.error('[WA-COT] ✗ FINAL ERROR:', e.message);
    await markError(cotizacion_id, 'whatsapp').catch(() => {});
    if (e.message === 'WHATSAPP_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'WhatsApp no configurado. Agrega WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN en Vercel.' });
    }
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/email/enviar-cotizacion ─────────────────────────────────────────
router.post('/email/enviar-cotizacion', async (req, res) => {
  const { email, cotizacion_id, link } = req.body;
  if (!email || !cotizacion_id) return res.status(400).json({ error: 'email y cotizacion_id son requeridos' });

  const SMTP_HOST = process.env.SMTP_HOST;
  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASS = process.env.SMTP_PASS;
  const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return res.status(503).json({ error: 'Email SMTP no configurado. Agrega SMTP_HOST, SMTP_USER y SMTP_PASS en Vercel.' });
  }

  try {
    const nodemailer  = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host:   SMTP_HOST,
      port:   Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth:   { user: SMTP_USER, pass: SMTP_PASS },
    });

    const codigo  = cotCode(cotizacion_id);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const logoUrl = `${baseUrl}/images/assets/logo-letras.png`;

    const cot = await fetchCot(cotizacion_id);

    const nombre   = cot?.clientes?.nombre || cot?.leads?.nombre || 'Cliente';
    const apellido = cot?.leads?.apellido || '';
    const nombreCompleto = apellido ? `${nombre} ${apellido}` : nombre;

    const det      = cot?.detalles_json || {};
    const mon      = cot?.moneda || 'USD';
    const factor   = mon === 'GTQ' ? 7.90 : 1;
    const sym      = mon === 'GTQ' ? 'Q' : '$';
    const fmtE     = n => sym + ((Number(n) || 0) * factor).toLocaleString('es-GT', { minimumFractionDigits: 2 });
    const servicios  = det.servicios || [];
    const anticipo   = Number(cot?.anticipo || 0);
    const descMonto  = Number(det.descuento_monto || 0);

    // 4-column service rows — dark theme matching portal
    const svcRowsHTML = servicios.map((s, i) => {
      const bg        = i % 2 === 0 ? '#0E1615' : '#131f18';
      const cantidad  = s.tipo_precio === 'por_m2' ? `${s.cantidad || 0} m²`
                      : s.tipo_precio === 'cotizar' ? 'A cotizar' : '1 ud';
      const unitPrice = s.tipo_precio === 'cotizar' ? '—' : fmtE(s.precio_unitario || 0);
      return `<tr style="background:${bg};">
        <td style="padding:8px 10px;font-size:13px;color:#F5F0E8;border-bottom:1px solid rgba(193,146,89,.1);">${s.descripcion || '—'}</td>
        <td style="padding:8px 10px;font-size:13px;color:#8A9990;text-align:center;border-bottom:1px solid rgba(193,146,89,.1);">${cantidad}</td>
        <td style="padding:8px 10px;font-size:13px;color:#8A9990;text-align:right;border-bottom:1px solid rgba(193,146,89,.1);">${unitPrice}</td>
        <td style="padding:8px 10px;font-size:13px;color:#B09A6C;font-weight:600;text-align:right;border-bottom:1px solid rgba(193,146,89,.1);">${fmtE(s.subtotal || 0)}</td>
      </tr>`;
    }).join('');

    // Totals mini — estructura idéntica al portal .totals-mini, tema oscuro
    // LBL/AMT: flex explícito para que etiqueta quede a la izquierda y monto a la derecha
    const ROW      = 'display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:13px;';
    const LBL      = 'flex:1;text-align:left;';
    const AMT      = 'flex:0 0 110px;text-align:right;font-variant-numeric:tabular-nums;';
    const descLabel = det.descuento_tipo === 'porcentaje' ? `Descuento (${det.descuento_valor}%)` : 'Descuento';
    const totalsMiniHTML = `
      <div style="background:rgba(193,146,89,.04);border:1px solid rgba(193,146,89,.18);border-radius:4px;padding:12px 16px;margin:16px 0;">
        ${det.subtotal != null ? `<div style="${ROW}color:#8A9990;"><span style="${LBL}">Subtotal</span><span style="${AMT}">${fmtE(det.subtotal)}</span></div>` : ''}
        ${descMonto > 0 ? `<div style="${ROW}color:#E08080;"><span style="${LBL}">${descLabel}</span><span style="${AMT}">-${fmtE(descMonto)}</span></div>` : ''}
        <div style="${ROW}color:#8A9990;"><span style="${LBL}">IVA 12%</span><span style="${AMT}">${fmtE(det.iva_monto || 0)}</span></div>
        <div style="${ROW}font-weight:700;color:#B09A6C;border-top:1px solid rgba(193,146,89,.18);margin-top:6px;padding-top:8px;">
          <span style="${LBL}">TOTAL</span><span style="${AMT}">${fmtE(det.total || cot?.monto || 0)}</span>
        </div>
      </div>
      ${anticipo > 0 ? `
      <div style="background:rgba(193,146,89,.08);border:1px solid rgba(193,146,89,.22);border-radius:4px;padding:14px 18px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:11px;color:#8A9990;text-transform:uppercase;letter-spacing:.5px;">Anticipo para iniciar</div>
          <div style="font-size:22px;font-weight:700;color:#B09A6C;margin-top:3px;">${fmtE(anticipo)}</div>
        </div>
        <div style="font-size:11px;color:#8A9990;text-align:right;line-height:1.6;">50% del total<br/>Restante: ${fmtE(Math.max(0, (det.total || 0) - anticipo))}</div>
      </div>` : ''}
    `;

    // Attach PDF — use stored documento_url first (already styled, avoids re-running puppeteer)
    let attachments = [];
    if (cot) {
      try {
        if (cot.documento_url) {
          const res = await fetch(cot.documento_url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const pdfBuf = Buffer.from(await res.arrayBuffer());
          attachments = [{ filename: `${codigo}.pdf`, content: pdfBuf, contentType: 'application/pdf' }];
          console.log('[Email] PDF attached from storage:', cot.documento_url.slice(0, 80));
        } else {
          throw new Error('no documento_url — regenerating');
        }
      } catch (fetchErr) {
        console.warn('[Email] PDF storage fetch failed, regenerating:', fetchErr.message);
        try {
          const pdfBuf = await generarCotizacionPDF(cot);
          attachments = [{ filename: `${codigo}.pdf`, content: pdfBuf, contentType: 'application/pdf' }];
        } catch (pdfErr) {
          console.error('[Email] PDF regeneration error:', pdfErr.message);
        }
      }
    }

    await transporter.sendMail({
      from:    `"Virtual Estate GT" <${SMTP_FROM}>`,
      to:      email,
      subject: `Tu Cotización Virtual Estate GT — ${codigo}`,
      attachments,
      html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0D4137;padding:0;">

  <!-- Header -->
  <div style="background:#0D4137;padding:28px 24px;text-align:center;border-bottom:3px solid #B09A6C;">
    <img src="${logoUrl}" alt="Virtual Estate GT" width="180" style="display:inline-block;max-width:180px;" />
    <h2 style="color:#B09A6C;margin:12px 0 0;font-size:15px;letter-spacing:1px;text-transform:uppercase;">Tu Cotización está lista</h2>
  </div>

  <!-- Card oscuro (igual portal) -->
  <div style="background:#0E1615;border-left:1px solid rgba(193,146,89,.18);border-right:1px solid rgba(193,146,89,.18);">

    <!-- Saludo -->
    <div style="padding:24px 24px 0;">
      <p style="font-size:16px;font-weight:700;color:#F5F0E8;margin:0 0 6px;">¡Hola ${nombreCompleto}! 👋</p>
      <p style="font-size:14px;line-height:1.6;color:#8A9990;margin:0 0 20px;">
        Hemos preparado tu cotización <strong style="color:#B09A6C;">${codigo}</strong>.
        ${attachments.length ? 'La encuentras adjunta a este correo.' : ''}
        Revisa los detalles y confírmala a través del enlace al final.
      </p>
    </div>

    ${servicios.length ? `
    <!-- Tabla servicios -->
    <div style="padding:0 24px;">
      <table style="width:100%;border-collapse:collapse;border:1px solid rgba(193,146,89,.18);">
        <thead>
          <tr style="background-color:#1E3028;">
            <th style="padding:9px 10px;font-size:12px;text-align:left;color:#B09A6C;letter-spacing:.5px;text-transform:uppercase;">Descripción</th>
            <th style="padding:9px 10px;font-size:12px;text-align:center;color:#B09A6C;letter-spacing:.5px;text-transform:uppercase;">Cant.</th>
            <th style="padding:9px 10px;font-size:12px;text-align:right;color:#B09A6C;letter-spacing:.5px;text-transform:uppercase;">P. Unit.</th>
            <th style="padding:9px 10px;font-size:12px;text-align:right;color:#B09A6C;letter-spacing:.5px;text-transform:uppercase;">Subtotal</th>
          </tr>
        </thead>
        <tbody>${svcRowsHTML}</tbody>
      </table>
    </div>` : ''}

    <!-- Totals mini (estructura idéntica al portal .totals-mini) -->
    <div style="padding:0 24px;">${totalsMiniHTML}</div>

    <!-- CTA -->
    <div style="padding:24px;">
      <a href="${link}" style="display:block;background:#B09A6C;color:#0D1A14;padding:14px 20px;border-radius:4px;text-decoration:none;font-weight:700;font-size:14px;text-align:center;letter-spacing:.5px;">
        Ver y confirmar cotización →
      </a>
      <p style="font-size:12px;color:#8A9990;margin-top:16px;text-align:center;line-height:1.6;">
        ¿Tienes preguntas? Escríbenos a
        <a href="mailto:info@virtualestategt.com" style="color:#B09A6C;text-decoration:none;">info@virtualestategt.com</a>
        o al <a href="tel:+50239902399" style="color:#B09A6C;text-decoration:none;">+502 3990 2399</a>
      </p>
    </div>

  </div><!-- /card -->

  <!-- Footer -->
  <div style="background:#0D4137;padding:14px 24px;text-align:center;border-top:1px solid rgba(193,146,89,.2);">
    <p style="font-size:11px;color:rgba(255,255,255,.6);margin:0;">Virtual Estate GT · Guatemala City · www.virtualestategt.com</p>
    <p style="font-size:11px;color:rgba(255,255,255,.4);margin:4px 0 0;">Si no solicitaste esta cotización, puedes ignorar este mensaje.</p>
  </div>

</div>
      `,
    });

    await markEnviado(cotizacion_id, 'email');
    res.json({ ok: true, canal: 'email', pdf_attached: attachments.length > 0 });
  } catch (e) {
    await markError(cotizacion_id, 'email').catch(() => {});
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/facebook/enviar-cotizacion ──────────────────────────────────────
router.post('/facebook/enviar-cotizacion', async (req, res) => {
  res.status(501).json({ error: 'Facebook Messenger requiere cuenta Meta Business aprobada. Próximamente disponible.' });
});

// ── POST /api/instagram/enviar-cotizacion ─────────────────────────────────────
router.post('/instagram/enviar-cotizacion', async (req, res) => {
  res.status(501).json({ error: 'Instagram DM requiere cuenta Meta Business aprobada. Próximamente disponible.' });
});

module.exports = router;
