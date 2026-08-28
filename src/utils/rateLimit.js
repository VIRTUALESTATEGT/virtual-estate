const supabase = require('../config/supabase');

// Parameterized rate-limit helpers (fail-open — DB errors never block users).
// auth.js keeps its own local functions for login/recuperar; this module is for
// public endpoints that need different windows or count successes as well.

async function checkRateLimit(ip, endpoint, maxAttempts, windowMs) {
  try {
    const { data } = await supabase
      .from('rate_limit_intentos')
      .select('id, intentos, ventana_inicio')
      .eq('ip', ip).eq('endpoint', endpoint)
      .maybeSingle();
    if (!data) return { blocked: false };
    const windowExpired = (Date.now() - new Date(data.ventana_inicio).getTime()) > windowMs;
    if (windowExpired) return { blocked: false };
    return { blocked: data.intentos >= maxAttempts, intentos: data.intentos };
  } catch { return { blocked: false }; }
}

async function recordAttempt(ip, endpoint, windowMs) {
  try {
    const { data } = await supabase
      .from('rate_limit_intentos')
      .select('id, intentos, ventana_inicio')
      .eq('ip', ip).eq('endpoint', endpoint)
      .maybeSingle();
    const now = new Date().toISOString();
    const windowExpired = !data || (Date.now() - new Date(data.ventana_inicio).getTime()) > windowMs;
    if (!data) {
      await supabase.from('rate_limit_intentos')
        .insert([{ ip, endpoint, intentos: 1, ventana_inicio: now, updated_at: now }]);
    } else if (windowExpired) {
      await supabase.from('rate_limit_intentos')
        .update({ intentos: 1, ventana_inicio: now, updated_at: now }).eq('id', data.id);
    } else {
      await supabase.from('rate_limit_intentos')
        .update({ intentos: data.intentos + 1, updated_at: now }).eq('id', data.id);
    }
  } catch (e) { console.error('[RateLimit] recordAttempt error:', e.message); }
}

module.exports = { checkRateLimit, recordAttempt };
