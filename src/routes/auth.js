const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'virtual-estate-secret-key';
const JWT_EXPIRES = '8h';

// ── Rate limiting (Supabase-backed — works across serverless instances) ───────
const RL_MAX_ATTEMPTS  = 5;
const RL_WINDOW_MS     = 15 * 60 * 1000; // 15 minutes

async function checkRateLimit(ip) {
  try {
    const { data } = await supabase
      .from('rate_limit_intentos')
      .select('id, intentos, ventana_inicio')
      .eq('ip', ip).eq('endpoint', 'login')
      .maybeSingle();
    if (!data) return { blocked: false };
    const windowExpired = (Date.now() - new Date(data.ventana_inicio).getTime()) > RL_WINDOW_MS;
    if (windowExpired) return { blocked: false };
    return { blocked: data.intentos >= RL_MAX_ATTEMPTS, intentos: data.intentos };
  } catch { return { blocked: false }; } // fail open — don't lock out on DB errors
}

async function recordFailedAttempt(ip) {
  try {
    const { data } = await supabase
      .from('rate_limit_intentos')
      .select('id, intentos, ventana_inicio')
      .eq('ip', ip).eq('endpoint', 'login')
      .maybeSingle();
    const now = new Date().toISOString();
    const windowExpired = !data || (Date.now() - new Date(data.ventana_inicio).getTime()) > RL_WINDOW_MS;
    if (!data) {
      await supabase.from('rate_limit_intentos')
        .insert([{ ip, endpoint: 'login', intentos: 1, ventana_inicio: now, updated_at: now }]);
    } else if (windowExpired) {
      await supabase.from('rate_limit_intentos')
        .update({ intentos: 1, ventana_inicio: now, updated_at: now }).eq('id', data.id);
    } else {
      await supabase.from('rate_limit_intentos')
        .update({ intentos: data.intentos + 1, updated_at: now }).eq('id', data.id);
    }
  } catch (e) { console.error('[RateLimit] recordFailedAttempt error:', e.message); }
}

async function resetRateLimit(ip) {
  try {
    await supabase.from('rate_limit_intentos')
      .update({ intentos: 0, updated_at: new Date().toISOString() })
      .eq('ip', ip).eq('endpoint', 'login');
  } catch { /* non-critical */ }
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  try {
    const rl = await checkRateLimit(ip);
    if (rl.blocked) {
      return res.status(429).json({ error: `Demasiados intentos fallidos. Espera 15 minutos antes de intentar de nuevo.` });
    }

    const { email, password } = req.body;
    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !data) {
      await recordFailedAttempt(ip);
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');

    if (data.password !== hashedPassword) {
      await recordFailedAttempt(ip);
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }
    await resetRateLimit(ip);

    const payload = {
      id: data.id,
      email: data.email,
      nombre: data.nombre,
      rol: data.role || 'asistente',
      role: data.role || 'asistente',
      is_superadmin: data.is_superadmin || false,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    // Ensure clientes record exists for portal users (in case registration upsert failed)
    if (data.role === 'cliente') {
      const { data: ec } = await supabase.from('clientes').select('id').eq('email', data.email).maybeSingle();
      if (!ec) {
        await supabase.from('clientes')
          .insert([{ nombre: data.nombre, email: data.email, tipo: 'Cliente' }]);
      }
    }

    res.json({
      token,
      usuario: payload,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// SIGNUP (internal staff — kept for compatibility)
router.post('/signup', async (req, res) => {
  try {
    const { nombre, email, password } = req.body;

    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');

    const { data, error } = await supabase
      .from('usuarios')
      .insert([{ nombre, email, password: hashedPassword, role: 'asistente', estado: 'activo' }])
      .select('id, nombre, email, role');

    if (error) throw error;

    res.status(201).json({ message: 'Usuario creado', usuario: data[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// REGISTRO CLIENTE — creates usuarios (role:cliente) + clientes record, returns JWT
router.post('/registro-cliente', async (req, res) => {
  try {
    const { nombre, email, password, telefono } = req.body;
    if (!nombre || !email || !password)
      return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos' });
    if (password.length < 8)
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

    // Check duplicate email
    const { data: existing } = await supabase
      .from('usuarios').select('id').eq('email', email).maybeSingle();
    if (existing)
      return res.status(409).json({ error: 'Ya existe una cuenta con este correo electrónico' });

    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');

    // Create usuarios record
    const { data: usuario, error: uErr } = await supabase
      .from('usuarios')
      .insert([{ nombre, email, password: hashedPassword, role: 'cliente', estado: 'activo' }])
      .select('id, nombre, email, role, is_superadmin')
      .single();
    if (uErr) throw uErr;

    // Ensure clientes record exists (insert or ignore if email already exists)
    const { data: existingCliente } = await supabase
      .from('clientes').select('id').eq('email', email).maybeSingle();
    if (!existingCliente) {
      const { error: cErr } = await supabase
        .from('clientes')
        .insert([{ nombre, email, telefono: telefono || '', tipo: 'Cliente' }]);
      if (cErr && cErr.code !== '23505') {
        console.error('[RegistroCliente] clientes insert:', cErr.message);
      }
    }

    const payload = {
      id: usuario.id,
      email: usuario.email,
      nombre: usuario.nombre,
      rol: 'cliente',
      role: 'cliente',
      is_superadmin: false,
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    res.status(201).json({ token, usuario: payload });
  } catch (e) {
    console.error('[RegistroCliente]', e.message);
    if (e.code === '23505')
      return res.status(409).json({ error: 'Ya existe una cuenta con este correo electrónico' });
    res.status(500).json({ error: e.message });
  }
});

// VERIFY — validates token and returns fresh user data from DB
router.get('/verify', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  try {
    const decoded = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    // Re-read from DB so is_superadmin / role changes take effect without re-login
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, email, nombre, role, is_superadmin')
      .eq('id', decoded.id)
      .single();
    if (error || !data) return res.status(401).json({ error: 'Usuario no encontrado' });
    const usuario = {
      id: data.id,
      email: data.email,
      nombre: data.nombre,
      rol: data.role || 'asistente',
      role: data.role || 'asistente',
      is_superadmin: data.is_superadmin || false,
    };
    res.json({ valid: true, usuario });
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
});

module.exports = router;
