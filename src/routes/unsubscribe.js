'use strict';

const express  = require('express');
const router   = express.Router();
const supabase = require('../config/supabase');

// ── HTML responses — same brand palette as the rest of the app ────────────────
const _page = (titulo, mensaje, extra = '') => `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${titulo} — Virtual Estate GT</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,sans-serif;background:#0D4137;min-height:100vh;
         display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#0E1615;border:1px solid rgba(193,146,89,.3);border-radius:8px;
          padding:40px 32px;max-width:480px;width:100%;text-align:center}
    .brand{color:#B09A6C;font-size:10px;font-weight:700;letter-spacing:2px;
           text-transform:uppercase;margin-bottom:20px}
    h1{color:#F5F0E8;font-size:20px;margin:0 0 14px;font-weight:600}
    p{color:#8A9990;font-size:13px;line-height:1.65;margin:0 0 14px}
    a{color:#B09A6C;text-decoration:none}
    .footer{margin-top:28px;font-size:11px;color:rgba(255,255,255,.3)}
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">Virtual Estate GT</div>
    <h1>${titulo}</h1>
    ${mensaje}
    ${extra}
    <div class="footer">Virtual Estate GT · Guatemala City · www.virtualestategt.com</div>
  </div>
</body>
</html>`;

// ── GET /api/unsubscribe?token=XXX ────────────────────────────────────────────
// Public — no auth required. Client clicks from their email.
// Only the opaque token is in the URL; no email or id exposed.
router.get('/', async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const { token } = req.query;

  // No token provided — generic page, no info leakage
  if (!token || typeof token !== 'string' || token.length < 8) {
    return res.send(_page(
      'Solicitud procesada',
      '<p>Si estabas suscrito a nuestros correos de seguimiento, has sido removido de la lista.</p>',
    ));
  }

  try {
    // Look up by token — don't reveal whether it exists or not in the error path
    const { data: cliente, error } = await supabase
      .from('clientes')
      .select('id, email_opt_out')
      .eq('unsubscribe_token', token)
      .maybeSingle();

    if (error) {
      console.error('[unsubscribe] DB error:', error.message);
      // Return generic success to avoid leaking DB state
      return res.send(_page(
        'Solicitud procesada',
        '<p>Si estabas suscrito a nuestros correos de seguimiento, has sido removido de la lista.</p>',
      ));
    }

    if (!cliente) {
      // Token not found — generic message, no confirmation either way
      return res.send(_page(
        'Solicitud procesada',
        '<p>Si estabas suscrito a nuestros correos de seguimiento, has sido removido de la lista.</p>',
      ));
    }

    if (!cliente.email_opt_out) {
      await supabase
        .from('clientes')
        .update({ email_opt_out: true })
        .eq('id', cliente.id);
      console.log(`[unsubscribe] cliente ${cliente.id} marcado email_opt_out=true`);
    }

    return res.send(_page(
      '✓ Baja confirmada',
      `<p>Has sido removido de nuestros correos de seguimiento.
       <strong style="color:#F5F0E8;">No recibirás más emails de este tipo.</strong></p>
       <p>Los correos relacionados con tus cotizaciones activas pueden seguir llegando
       ya que son parte de tu servicio contratado.</p>`,
      `<p style="font-size:12px;margin-top:4px;">¿Fue un error? Escríbenos a
       <a href="mailto:info@virtualestategt.com">info@virtualestategt.com</a>
       para reactivar tus correos.</p>`,
    ));

  } catch (e) {
    console.error('[unsubscribe] exception:', e.message);
    return res.send(_page(
      'Solicitud procesada',
      '<p>Si estabas suscrito a nuestros correos de seguimiento, has sido removido de la lista.</p>',
    ));
  }
});

module.exports = router;
