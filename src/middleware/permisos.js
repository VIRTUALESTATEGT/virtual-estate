const supabase = require('../config/supabase');

function verificarPermiso(permiso) {
  return async (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'No autenticado.' });
    if (req.usuario.is_superadmin) return next();
    try {
      const { data } = await supabase
        .from('permisos_usuario')
        .select('valor')
        .eq('usuario_id', req.usuario.id)
        .eq('permiso', permiso)
        .maybeSingle();
      if (!data || !data.valor) {
        return res.status(403).json({ error: `Permiso denegado: ${permiso}` });
      }
      next();
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  };
}

module.exports = verificarPermiso;
