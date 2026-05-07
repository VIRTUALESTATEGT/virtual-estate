const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'virtual-estate-secret-key';
const JWT_EXPIRES = '8h';

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !data) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');

    if (data.password !== hashedPassword) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    const payload = {
      id: data.id,
      email: data.email,
      nombre: data.nombre,
      rol: data.role || 'asistente',
      role: data.role || 'asistente',
      is_superadmin: data.is_superadmin || false,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

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

    // Upsert clientes record (handles case where they were a lead before)
    await supabase.from('clientes').upsert(
      [{ nombre, email, telefono: telefono || '', tipo: 'Cliente' }],
      { onConflict: 'email' }
    );

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
