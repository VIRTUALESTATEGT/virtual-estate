const crypto  = require('crypto');
const bcrypt   = require('bcryptjs');
const supabase = require('../config/supabase');

async function hashPassword(pwd) {
  return bcrypt.hash(pwd, 10);
}

async function verificarPassword(pwd, hashGuardado, usuarioId) {
  if (hashGuardado.startsWith('$2a$') || hashGuardado.startsWith('$2b$')) {
    return bcrypt.compare(pwd, hashGuardado);
  }
  // Legacy SHA-256 hex (64 chars) — verifica y re-hashea silenciosamente
  const sha = crypto.createHash('sha256').update(pwd).digest('hex');
  if (sha !== hashGuardado) return false;
  // Coincide: migrar a bcrypt en segundo plano, no bloquea el login
  hashPassword(pwd).then(nuevoHash =>
    supabase.from('usuarios').update({ password: nuevoHash }).eq('id', usuarioId)
      .then(({ error }) => { if (error) console.error('[auth] rehash error:', error.message); })
  ).catch(e => console.error('[auth] rehash error:', e.message));
  return true;
}

module.exports = { hashPassword, verificarPassword };
