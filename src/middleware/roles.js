const ROLE_HIERARCHY = { asistente: 0, agente: 1, admin: 2, gerente: 3 };

// Middleware: require one of the listed roles (or superadmin)
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'No autenticado.' });
    if (req.usuario.is_superadmin) return next();
    const userRole = req.usuario.role || req.usuario.rol || 'asistente';
    if (roles.includes(userRole)) return next();
    return res.status(403).json({
      error: `Acceso denegado. Roles permitidos: ${roles.join(', ')}. Tu rol: ${userRole}`
    });
  };
}

// Middleware: require minimum role level (e.g. requireMinRole('agente') allows agente, admin, gerente)
function requireMinRole(minRole) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'No autenticado.' });
    if (req.usuario.is_superadmin) return next();
    const userLevel = ROLE_HIERARCHY[req.usuario.role || req.usuario.rol || 'asistente'] ?? 0;
    const minLevel = ROLE_HIERARCHY[minRole] ?? 0;
    if (userLevel >= minLevel) return next();
    return res.status(403).json({
      error: `Acceso denegado. Se requiere rol mínimo: ${minRole}.`
    });
  };
}

// Middleware: require superadmin
function requireSuperadmin(req, res, next) {
  if (!req.usuario) return res.status(401).json({ error: 'No autenticado.' });
  if (req.usuario.is_superadmin === true) return next();
  return res.status(403).json({ error: 'Solo superadmin puede realizar esta acción.' });
}

// Strip sensitive fields before sending user objects in responses
function sanitizeUsuario(u) {
  if (!u) return u;
  const { password_hash, password, ...safe } = u;
  return safe;
}

module.exports = { requireRole, requireMinRole, requireSuperadmin, sanitizeUsuario };
