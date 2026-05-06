const supabase = require('../config/supabase');

// Tables/actions that should be audited
const SENSITIVE_TABLES = new Set([
  'usuarios', 'permisos_usuario', 'clientes',
  'cliente_verificacion_identidad', 'cotizaciones',
  'instrucciones_ia_dinamicas', 'zonas_seguridad',
]);

// Log to console (always) and optionally to DB for high-value events
async function logAudit({ usuario_id, usuario_email, accion, recurso, recurso_id, detalles, ip }) {
  const entry = {
    ts: new Date().toISOString(),
    usuario_id: usuario_id || null,
    usuario_email: usuario_email || 'anon',
    accion,
    recurso,
    recurso_id: recurso_id ? String(recurso_id) : null,
    detalles: detalles || null,
    ip: ip || null,
  };

  console.log('[AUDIT]', JSON.stringify(entry));

  // Persist to DB only for sensitive tables (fire-and-forget, never block the request)
  if (SENSITIVE_TABLES.has(recurso)) {
    supabase.from('audit_log').insert([entry]).then(({ error }) => {
      if (error && !error.message.includes('does not exist')) {
        console.error('[AUDIT] DB write failed:', error.message);
      }
    });
  }
}

// Express middleware factory: audit a route automatically
// Usage: router.delete('/:id', auditMiddleware('clientes', 'DELETE'), handler)
function auditMiddleware(recurso, accion) {
  return (req, res, next) => {
    const u = req.usuario || {};
    const id = req.params.id || null;
    logAudit({
      usuario_id: u.id,
      usuario_email: u.email,
      accion,
      recurso,
      recurso_id: id,
      ip: req.ip || req.headers['x-forwarded-for'],
    });
    next();
  };
}

module.exports = { logAudit, auditMiddleware };
