const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// GET todos los leads
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('*');
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST nuevo lead
router.post('/', async (req, res) => {
  try {
    const { nombre, email, telefono, empresa, estado } = req.body;
    const { data, error } = await supabase
      .from('leads')
      .insert([{ nombre, email, telefono, empresa, estado }]);
    
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;