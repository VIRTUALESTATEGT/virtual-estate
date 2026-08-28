'use strict';

// ── Shared email utility — Virtual Estate GT ──────────────────────────────────
// Provides: enviarEmail, registrarEmail, yaSeEnvio, buildEmailBase
// Based on the smtpWithRetry pattern from confirmacion.js (Zoho-aware).
const { maskEmail } = require('./mask');
// The two existing email implementations (confirmacion.js, envio-cotizacion.js)
// are NOT migrated here yet — they continue working as-is until a future step.

const supabase = require('../config/supabase');

// ── Transport factory — Zoho-aware config ────────────────────────────────────
function _crearTransport() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return require('nodemailer').createTransport({
    host:              SMTP_HOST,
    port:              Number(SMTP_PORT) || 587,
    secure:            Number(SMTP_PORT) === 465,
    auth:              { user: SMTP_USER, pass: SMTP_PASS },
    pool:              false,
    connectionTimeout: 40000,
    greetingTimeout:   20000,
    socketTimeout:     60000,
    tls:               { rejectUnauthorized: false },
  });
}

// ── Core send with retry — mirrors smtpWithRetry in confirmacion.js ───────────
// preDelay: ms before first attempt (lets prior Zoho SMTP session close).
async function _smtpWithRetry(mailOpts, label, maxAttempts = 3, preDelay = 0) {
  if (preDelay > 0) {
    console.log(`[email] ${label} pre-delay ${preDelay}ms`);
    await new Promise(r => setTimeout(r, preDelay));
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const transport = _crearTransport();
    if (!transport) throw new Error('SMTP_NOT_CONFIGURED');
    try {
      console.log(`[email] ${label} attempt ${attempt} → ${maskEmail(mailOpts.to)} | html: ${(mailOpts.html || '').length}B`);
      await transport.sendMail(mailOpts);
      transport.close();
      console.log(`[email] ${label} ✅ OK (attempt ${attempt})`);
      return;
    } catch (e) {
      transport.close();
      if (attempt === maxAttempts) throw e;
      console.warn(`[email] ${label} attempt ${attempt} failed: ${e.message} — retry in 6s`);
      await new Promise(r => setTimeout(r, 6000));
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send a single email.
 * @param {{ to, subject, html, attachments?, label? }} opts
 * @throws if SMTP not configured or all retries exhausted
 */
async function enviarEmail({ to, subject, html, attachments, label }) {
  const from = `"Virtual Estate GT" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`;
  const mailOpts = { from, to, subject, html };
  if (attachments?.length) mailOpts.attachments = attachments;
  await _smtpWithRetry(mailOpts, label || subject.slice(0, 40));
}

/**
 * Record an email send (success or error) in email_log.
 * Fire-and-forget safe — never throws.
 */
async function registrarEmail({ destinatario, tipo_email, referencia_id = null, estado = 'enviado', error_detalle = null }) {
  try {
    await supabase.from('email_log').insert([{
      destinatario,
      tipo_email,
      referencia_id: referencia_id || null,
      estado,
      error_detalle: error_detalle || null,
    }]);
  } catch (e) {
    console.error('[email] registrarEmail error:', e.message);
  }
}

/**
 * Check if a given email type was already successfully sent to this address/reference.
 * Returns true → skip send; false → safe to send.
 */
async function yaSeEnvio({ destinatario, tipo_email, referencia_id = null }) {
  try {
    const query = supabase
      .from('email_log')
      .select('id', { count: 'exact', head: true })
      .eq('destinatario', destinatario)
      .eq('tipo_email', tipo_email)
      .eq('estado', 'enviado');

    // referencia_id can be null (e.g. welcome email not tied to a cotizacion)
    if (referencia_id != null) query.eq('referencia_id', referencia_id);
    else query.is('referencia_id', null);

    const { count, error } = await query;
    if (error) { console.error('[email] yaSeEnvio error:', error.message); return false; }
    return (count || 0) > 0;
  } catch (e) {
    console.error('[email] yaSeEnvio exception:', e.message);
    return false; // fail open: if we can't check, allow send
  }
}

/**
 * Wrap arbitrary HTML content in the Virtual Estate GT brand shell.
 * @param {{ titulo, subtitulo?, cuerpoHtml, ctaTexto?, ctaLink?, unsubscribeToken? }} opts
 * unsubscribeToken: when provided, adds an unsubscribe link in the footer.
 *   Only pass for follow-up/marketing emails — NOT for transactional ones.
 */
function buildEmailBase({ titulo, subtitulo, cuerpoHtml, ctaTexto, ctaLink, unsubscribeToken }) {
  const ctaBlock = ctaTexto && ctaLink ? `
  <div style="padding:0 24px 24px;">
    <a href="${ctaLink}"
       style="display:block;background:#B09A6C;color:#0D1A14;padding:14px 20px;
              border-radius:4px;text-decoration:none;font-weight:700;font-size:14px;
              text-align:center;letter-spacing:.5px;">
      ${ctaTexto} →
    </a>
  </div>` : '';

  const subtituloBlock = subtitulo ? `
  <p style="font-size:13px;color:#8A9990;margin:4px 0 20px;line-height:1.6;">${subtitulo}</p>` : '';

  const unsubscribeBlock = unsubscribeToken ? `
    <p style="font-size:10px;color:rgba(255,255,255,.3);margin:6px 0 0;">
      <a href="${buildUnsubscribeLink(unsubscribeToken)}"
         style="color:rgba(193,146,89,.5);text-decoration:underline;">
        Cancelar suscripción a correos de seguimiento
      </a>
    </p>` : '';

  return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0D4137;padding:0;">

  <!-- Header -->
  <div style="background:#0D4137;padding:28px 24px;text-align:center;border-bottom:3px solid #B09A6C;">
    <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#B09A6C;margin-bottom:6px;">
      VIRTUAL ESTATE GT
    </div>
    <h2 style="color:#F5F0E8;margin:0;font-size:18px;font-weight:600;">${titulo}</h2>
  </div>

  <!-- Card -->
  <div style="background:#0E1615;border-left:1px solid rgba(193,146,89,.18);
              border-right:1px solid rgba(193,146,89,.18);">

    <!-- Body slot -->
    <div style="padding:24px 24px 0;">
      ${subtituloBlock}
      ${cuerpoHtml}
    </div>

    ${ctaBlock}
  </div>

  <!-- Footer -->
  <div style="background:#0D4137;padding:16px 24px;text-align:center;
              border-top:1px solid rgba(193,146,89,.2);">
    <p style="font-size:11px;color:rgba(255,255,255,.6);margin:0;">
      Virtual Estate GT · Guatemala City · www.virtualestategt.com
    </p>
    <p style="font-size:11px;color:rgba(255,255,255,.4);margin:4px 0 0;">
      Si tienes dudas, escríbenos a
      <a href="mailto:info@virtualestategt.com"
         style="color:rgba(193,146,89,.7);text-decoration:none;">info@virtualestategt.com</a>
    </p>
    ${unsubscribeBlock}
  </div>

</div>`;
}

// ── Opt-out helpers ───────────────────────────────────────────────────────────

/**
 * Build the public unsubscribe URL from a client token.
 * Only the opaque token appears in the URL — no email or id exposed.
 */
function buildUnsubscribeLink(token) {
  const base = process.env.APP_URL || 'https://www.virtualestategt.com';
  return `${base}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

/**
 * Check if a client has opted out of follow-up emails.
 * Accept either { id } or { email } — at least one required.
 * Returns true → do NOT send; false → safe to send.
 * Fail-open: if DB fails, returns false (allow send rather than block forever).
 */
async function clienteOptOut({ id, email }) {
  try {
    let query = supabase.from('clientes').select('email_opt_out');
    if (id)    query = query.eq('id', id);
    else if (email) query = query.eq('email', email);
    else return false;

    const { data, error } = await query.maybeSingle();
    if (error) { console.error('[email] clienteOptOut error:', error.message); return false; }
    return data?.email_opt_out === true;
  } catch (e) {
    console.error('[email] clienteOptOut exception:', e.message);
    return false;
  }
}

module.exports = { enviarEmail, registrarEmail, yaSeEnvio, buildEmailBase, buildUnsubscribeLink, clienteOptOut };
