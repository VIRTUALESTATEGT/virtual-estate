const express = require('express');
const router  = express.Router();
const supabase = require('../config/supabase');
const { sendWhatsAppMessage, sendWhatsAppDocument } = require('../utils/whatsapp');

// Helpers
const yr2     = () => String(new Date().getFullYear()).slice(-2);
const cotCode = id => `COT-${yr2()}-${String(id).padStart(5, '0')}`;
const fmtNum  = (n, sym) => sym + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2 });

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

// ── HTML builder for PDF (mirrors verPreviaCotizacionPDF logic in admin.html) ─
function buildCotizacionHTML(cot) {
  const fs   = require('fs');
  const path = require('path');

  const codigo  = cotCode(cot.id);
  const det     = cot.detalles_json || {};
  const mon     = cot.moneda || 'USD';
  const factor  = mon === 'GTQ' ? 7.90 : 1;
  const sym     = mon === 'GTQ' ? 'Q' : '$';
  const fmt     = n => sym + ((Number(n) || 0) * factor).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const nombre   = cot.clientes?.nombre || cot.leads?.nombre || 'Cliente';
  const empresa  = cot.clientes?.empresa || '—';
  const email    = cot.clientes?.email || cot.leads?.email || '—';
  const tel      = cot.clientes?.telefono || cot.leads?.telefono || '—';
  const dir      = cot.ubicacion_completa || [cot.ubicacion_calle, cot.ubicacion_zona, cot.ubicacion_ciudad].filter(Boolean).join(', ') || 'Guatemala';
  const fecha    = new Date(cot.created_at || Date.now()).toLocaleDateString('es-GT', { day: 'numeric', month: 'long', year: 'numeric' });

  const servicios   = det.servicios || [];
  const subtotalUSD = servicios.reduce((s, l) => s + (Number(l.subtotal) || 0), 0);
  const descMonto   = Number(det.descuento_monto) || 0;
  const subtotal2   = Math.max(0, subtotalUSD - descMonto);
  const ivaMonto    = subtotal2 * 0.12;
  const total       = subtotal2 + ivaMonto;
  const anticipo    = Number(cot.anticipo) || 0;
  const descTipo    = det.descuento_tipo || 'porcentaje';
  const descValor   = Number(det.descuento_valor) || 0;

  const svcRows = servicios.map(s => {
    const unit = s.tipo_precio === 'por_m2' ? (s.cantidad || 0) + ' m²'
               : s.tipo_precio === 'cotizar' ? 'A cotizar' : '1 unidad';
    return `<tr><td>${s.descripcion || '—'}</td><td style="text-align:center">${unit}</td><td class="r">${fmt(s.subtotal || 0)}</td></tr>`;
  }).join('');

  const discRow  = descMonto > 0 ? `<tr class="sub"><td colspan="2">${descTipo === 'porcentaje' ? `Descuento (${descValor}%)` : 'Descuento'}</td><td class="r">-${fmt(descMonto)}</td></tr>` : '';
  const sub2Row  = descMonto > 0 ? `<tr class="sub"><td colspan="2">Subtotal neto</td><td class="r">${fmt(subtotal2)}</td></tr>` : '';
  const tbodyHtml = svcRows
    + '<tr><td></td><td></td><td></td></tr>'
    + `<tr class="sub"><td colspan="2">Subtotal</td><td class="r">${fmt(subtotalUSD)}</td></tr>`
    + discRow + sub2Row
    + `<tr class="sub"><td colspan="2">IVA 12 %</td><td class="r">${fmt(ivaMonto)}</td></tr>`
    + `<tr class="tot"><td colspan="2">TOTAL</td><td class="r">${fmt(total)}</td></tr>`;

  const machoteFile = path.join(process.cwd(), 'public', 'assets', 'machote-cotizacion.html');
  let html = fs.readFileSync(machoteFile, 'utf8');
  // Strip scripts and external font links (Google Fonts blocks networkidle in serverless)
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>/gi, '');

  const dataScript = `<script>(function(){
    var codEl=document.querySelector(".doc-codigo-valor");if(codEl)codEl.textContent=${JSON.stringify(codigo)};
    var cv=document.querySelectorAll(".campo-val");
    if(cv[0])cv[0].textContent=${JSON.stringify(nombre)};
    if(cv[1])cv[1].textContent=${JSON.stringify(empresa)};
    if(cv[2])cv[2].textContent=${JSON.stringify(tel)};
    if(cv[3])cv[3].textContent=${JSON.stringify(email)};
    if(cv[4])cv[4].textContent=${JSON.stringify(dir)};
    var fechaEl=document.getElementById("fecha-doc");if(fechaEl)fechaEl.textContent=${JSON.stringify(fecha)};
    var tbody=document.querySelector(".tabla tbody");if(tbody)tbody.innerHTML=${JSON.stringify(tbodyHtml)};
    var firmas=document.querySelectorAll(".firma-nom");if(firmas[1])firmas[1].textContent=${JSON.stringify(nombre)};
  })();<\/script>`;

  return html.replace('</body>', dataScript + '</body>');
}

// ── PDF generation via puppeteer (identical to CRM preview) ──────────────────
async function generarCotizacionPDF(cot) {
  let browser;
  try {
    const chromium  = require('@sparticuz/chromium');
    const puppeteer = require('puppeteer-core');

    browser = await puppeteer.launch({
      args:            chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath:  await chromium.executablePath(),
      headless:        true,
    });

    const page = await browser.newPage();
    const html = buildCotizacionHTML(cot);
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    return Buffer.from(pdf);
  } catch (puppErr) {
    console.error('[PDF] puppeteer failed, falling back to pdfkit:', puppErr.message);
    return generarCotizacionPDFFallback(cot);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ── pdfkit fallback (basic branded layout) ───────────────────────────────────
async function generarCotizacionPDFFallback(cot) {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data',  c => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const codigo   = cotCode(cot.id);
    const det      = cot.detalles_json || {};
    const mon      = cot.moneda || 'USD';
    const factor   = mon === 'GTQ' ? 7.90 : 1;
    const sym      = mon === 'GTQ' ? 'Q' : '$';
    const fmt      = n => sym + ((Number(n) || 0) * factor).toLocaleString('es-GT', { minimumFractionDigits: 2 });
    const nombre   = cot.clientes?.nombre || cot.leads?.nombre || 'Cliente';
    const fecha    = new Date(cot.created_at || Date.now()).toLocaleDateString('es-GT');

    doc.fontSize(18).font('Helvetica-Bold').fillColor('#1a1a1a').text('VIRTUAL ESTATE GT', { align: 'center' });
    doc.fontSize(9).font('Helvetica').fillColor('#888').text('www.virtualestategt.com  |  info@virtualestategt.com  |  +502 39902399', { align: 'center' });
    doc.moveDown(0.4);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#C19259').lineWidth(2).stroke();
    doc.moveDown(0.4);
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#C19259').text(`COTIZACIÓN ${codigo}`, { align: 'center' });
    doc.moveDown(0.6);
    doc.fontSize(9).font('Helvetica').fillColor('#333');
    doc.text(`Fecha: ${fecha}     Cliente: ${nombre}`);
    if (cot.ubicacion_completa) doc.text(`Dirección: ${cot.ubicacion_completa}`);
    doc.moveDown(0.7);

    const servicios = det.servicios || [];
    if (servicios.length) {
      const X = 50, W = [240, 60, 90, 105];
      doc.rect(X, doc.y, W[0]+W[1]+W[2]+W[3], 18).fill('#1a1a1a');
      const hy = doc.y - 18 + 5;
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#C19259');
      doc.text('DESCRIPCIÓN', X+4, hy, { width: W[0]-4 });
      doc.text('CANT.', X+W[0], hy, { width: W[1], align: 'right' });
      doc.text('P. UNIT.', X+W[0]+W[1], hy, { width: W[2], align: 'right' });
      doc.text('SUBTOTAL', X+W[0]+W[1]+W[2], hy, { width: W[3]-4, align: 'right' });
      doc.moveDown(0.2);
      doc.font('Helvetica').fillColor('#1a1a1a').fontSize(8);
      servicios.forEach((s, i) => {
        const ry = doc.y;
        if (i % 2 === 0) { doc.rect(X, ry, W[0]+W[1]+W[2]+W[3], 14).fill('#f9f9f9'); doc.fillColor('#1a1a1a'); }
        doc.text(s.descripcion || '—', X+4, ry+2, { width: W[0]-4 });
        doc.text(String(s.cantidad || 1), X+W[0], ry+2, { width: W[1], align: 'right' });
        doc.text(fmt(s.precio_unitario), X+W[0]+W[1], ry+2, { width: W[2], align: 'right' });
        doc.text(fmt(s.subtotal), X+W[0]+W[1]+W[2], ry+2, { width: W[3]-4, align: 'right' });
        doc.moveDown(0.5);
      });
      doc.moveDown(0.3);
    }

    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ddd').lineWidth(1).stroke();
    doc.moveDown(0.4);
    const tRow = (label, val, bold = false, color = '#1a1a1a') => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(color);
      doc.text(label, 340, y, { width: 120, align: 'right' });
      doc.text(fmt(val), 465, y, { width: 78, align: 'right' });
      doc.moveDown(0.35);
    };
    const subtotalUSD = det.subtotal || cot.monto || 0;
    const descMonto   = det.descuento_monto || 0;
    const ivaMonto    = det.iva_monto || 0;
    const total       = det.total || cot.monto || 0;
    tRow('Subtotal', subtotalUSD);
    if (descMonto > 0) tRow('Descuento', -descMonto, false, '#E08080');
    tRow('IVA (12%)', ivaMonto);
    tRow('TOTAL', total, true);
    doc.moveTo(340, doc.y).lineTo(543, doc.y).strokeColor('#C19259').lineWidth(1).stroke();
    doc.moveDown(0.4);
    tRow('Anticipo requerido', cot.anticipo || 0, true, '#C19259');

    doc.moveDown(1.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ddd').lineWidth(1).stroke();
    doc.moveDown(0.4);
    doc.fontSize(7.5).font('Helvetica').fillColor('#888')
       .text('Cotización formal de Virtual Estate GT. Para confirmar, visita el enlace enviado por tu asesor.', { align: 'center' });
    doc.end();
  });
}

async function subirPDFSupabase(pdfBuffer, filename) {
  const { data, error } = await supabase.storage
    .from('virtual-estate-documents')
    .upload(`cotizaciones/${filename}`, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });
  if (error) throw new Error('Storage upload error: ' + error.message);
  const { data: urlData } = supabase.storage
    .from('virtual-estate-documents')
    .getPublicUrl(`cotizaciones/${filename}`);
  return urlData.publicUrl;
}

// ── POST /api/whatsapp/enviar-cotizacion ──────────────────────────────────────
router.post('/whatsapp/enviar-cotizacion', async (req, res) => {
  const { phone_number, cotizacion_id, link } = req.body;
  if (!phone_number || !cotizacion_id) {
    return res.status(400).json({ error: 'phone_number y cotizacion_id son requeridos' });
  }
  try {
    const codigo = cotCode(cotizacion_id);

    // Fetch cotización for PDF
    const { data: cot, error: cotErr } = await supabase
      .from('cotizaciones')
      .select('*, clientes(nombre), leads(nombre)')
      .eq('id', cotizacion_id)
      .maybeSingle();

    let pdfSent = false;
    if (!cotErr && cot) {
      try {
        const pdfBuf  = await generarCotizacionPDF(cot);
        const filename = `${codigo}.pdf`;
        const pdfUrl   = await subirPDFSupabase(pdfBuf, filename);
        const docResult = await sendWhatsAppDocument(phone_number, pdfUrl, filename);
        if (docResult) pdfSent = true;
      } catch (pdfErr) {
        console.error('[WhatsApp] PDF generation/upload error:', pdfErr.message);
      }
    }

    // Always send the text link message
    const textMsg = pdfSent
      ? `Aquí tu cotización formal *${codigo}*. 👆\n\n✅ Para confirmar y revisar detalles, accede aquí:\n${link}`
      : `Hola 👋 Te enviamos tu cotización *${codigo}* de Virtual Estate GT.\n\n📋 Revisa y confirma aquí:\n${link}\n\n¿Tienes alguna pregunta? Responde este mensaje.`;

    const result = await sendWhatsAppMessage(phone_number, textMsg);
    if (!result) throw new Error('WHATSAPP_NOT_CONFIGURED');

    await markEnviado(cotizacion_id, 'whatsapp');
    res.json({ ok: true, canal: 'whatsapp', pdf_sent: pdfSent });
  } catch (e) {
    await markError(cotizacion_id, 'whatsapp').catch(() => {});
    if (e.message === 'WHATSAPP_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'WhatsApp no está configurado. Configura WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN en Vercel.' });
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

    // Fetch cotización data for PDF generation and email template
    let cot = null;
    try {
      const { data } = await supabase
        .from('cotizaciones')
        .select('*, clientes(nombre, empresa, email, telefono), leads(nombre, email, telefono)')
        .eq('id', cotizacion_id)
        .maybeSingle();
      cot = data;
    } catch (_) {}

    const nombre   = cot?.clientes?.nombre || cot?.leads?.nombre || 'Cliente';
    const det      = cot?.detalles_json || {};
    const mon      = cot?.moneda || 'USD';
    const factor   = mon === 'GTQ' ? 7.90 : 1;
    const sym      = mon === 'GTQ' ? 'Q' : '$';
    const fmtE     = n => sym + ((Number(n) || 0) * factor).toLocaleString('es-GT', { minimumFractionDigits: 2 });
    const servicios = det.servicios || [];
    const anticipo  = Number(cot?.anticipo || 0);

    const svcRowsHTML = servicios.map(s => `
      <tr>
        <td style="padding:.5rem .75rem;font-size:.78rem;color:#333;border-bottom:1px solid #f0f0f0;">${s.descripcion || '—'}</td>
        <td style="padding:.5rem .75rem;font-size:.78rem;color:#C19259;font-weight:600;text-align:right;border-bottom:1px solid #f0f0f0;">${fmtE(s.subtotal || 0)}</td>
      </tr>`).join('');

    // Attach PDF if possible
    let attachments = [];
    if (cot) {
      try {
        const pdfBuf = await generarCotizacionPDF(cot);
        attachments = [{ filename: `${codigo}.pdf`, content: pdfBuf, contentType: 'application/pdf' }];
      } catch (pdfErr) {
        console.error('[Email] PDF generation error:', pdfErr.message);
      }
    }

    await transporter.sendMail({
      from:    `"Virtual Estate GT" <${SMTP_FROM}>`,
      to:      email,
      subject: `Tu Cotización Virtual Estate GT — ${codigo}`,
      attachments,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;">
          <div style="background:#0D4137;padding:1.5rem 2rem;text-align:center;border-bottom:3px solid #B09A6C;">
            <img src="${logoUrl}" alt="Virtual Estate GT" width="180" style="display:inline-block;max-width:180px;" />
          </div>
          <div style="padding:2rem 2rem 1rem;">
            <p style="font-size:1rem;font-weight:700;color:#1a1a1a;margin:0 0 .5rem;">¡Hola ${nombre}! 👋</p>
            <p style="font-size:.88rem;line-height:1.6;color:#444;margin:0 0 1.2rem;">
              Hemos preparado tu cotización <strong>${codigo}</strong>.
              ${attachments.length ? 'La encuentras adjunta a este correo.' : ''}
              Revisa los detalles y confírmala a través del enlace al final.
            </p>
            ${servicios.length ? `
            <table style="width:100%;border-collapse:collapse;margin-bottom:1.2rem;">
              <thead>
                <tr style="background:#1a1a1a;">
                  <th style="padding:.5rem .75rem;font-size:.72rem;text-align:left;color:#C19259;letter-spacing:.06em;text-transform:uppercase;">Servicio</th>
                  <th style="padding:.5rem .75rem;font-size:.72rem;text-align:right;color:#C19259;letter-spacing:.06em;text-transform:uppercase;">Subtotal</th>
                </tr>
              </thead>
              <tbody>${svcRowsHTML}</tbody>
            </table>` : ''}
            <div style="background:#faf8f5;border:1px solid #e8d5bb;border-radius:4px;padding:1rem 1.2rem;margin-bottom:1.4rem;">
              <div style="display:flex;justify-content:space-between;font-size:.82rem;color:#555;padding:.2rem 0;">
                <span>Total</span><span style="font-weight:700;color:#C19259;">${fmtE(det.total || cot?.monto || 0)}</span>
              </div>
              ${anticipo > 0 ? `
              <div style="display:flex;justify-content:space-between;font-size:.82rem;color:#555;padding:.5rem 0 .2rem;border-top:1px solid #e8d5bb;margin-top:.4rem;">
                <span>Anticipo requerido</span><span style="font-weight:700;color:#C19259;">${fmtE(anticipo)}</span>
              </div>` : ''}
            </div>
            <a href="${link}" style="display:block;background:#C19259;color:#fff;padding:.85rem 1.5rem;border-radius:4px;text-decoration:none;font-weight:700;font-size:.85rem;text-align:center;letter-spacing:.05em;">
              Ver y confirmar cotización →
            </a>
            <p style="font-size:.75rem;color:#aaa;margin-top:1.5rem;line-height:1.6;text-align:center;">
              ¿Tienes preguntas? Escríbenos a
              <a href="mailto:info@virtualestategt.com" style="color:#C19259;text-decoration:none;">info@virtualestategt.com</a>
              o al <a href="tel:+50239902399" style="color:#C19259;text-decoration:none;">+502 3990 2399</a>
            </p>
          </div>
          <div style="background:#0D4137;padding:1rem 2rem;text-align:center;">
            <p style="font-size:.65rem;color:rgba(255,255,255,.6);margin:0;">Virtual Estate GT · Guatemala City · www.virtualestategt.com</p>
            <p style="font-size:.65rem;color:#555;margin:.3rem 0 0;">Si no solicitaste esta cotización, puedes ignorar este mensaje.</p>
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
