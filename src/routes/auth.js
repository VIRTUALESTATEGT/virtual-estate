const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const crypto = require('crypto');

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('email', email);
    
    console.log('Error:', error);
    console.log('Data:', data);
    
    if (error || !data || data.length === 0) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }
    
    const usuario = data[0];
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    
    if (usuario.password !== hashedPassword) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }
    
    const token = crypto.randomBytes(32).toString('hex');
    
    res.json({ 
      token, 
      usuario: { 
        id: usuario.id, 
        nombre: usuario.nombre, 
        email: usuario.email, 
        rol: usuario.rol 
      } 
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
      .insert([{ 
        nombre, 
        email, 
        password: hashedPassword, 
        rol: 'user',
        estado: 'activo'
      }]);
    
    if (error) throw error;
    
    res.status(201).json({ message: 'Usuario creado', data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;