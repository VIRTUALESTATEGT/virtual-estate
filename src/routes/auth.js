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
      rol: data.rol,
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

// SIGNUP
router.post('/signup', async (req, res) => {
  try {
    const { nombre, email, password } = req.body;

    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');

    const { data, error } = await supabase
      .from('usuarios')
      .insert([{ nombre, email, password: hashedPassword, rol: 'user', estado: 'activo' }])
      .select('id, nombre, email, rol');

    if (error) throw error;

    res.status(201).json({ message: 'Usuario creado', usuario: data[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// VERIFY (para el frontend al cargar la página)
router.get('/verify', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  try {
    const payload = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    res.json({ valid: true, usuario: payload });
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
});

module.exports = router;
