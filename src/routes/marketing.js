// src/routes/marketing.js — Módulo Marketing Fase 1
const express = require('express');
const router  = express.Router();

router.get('/status', (_req, res) => {
  res.json({ ok: true, modulo: 'marketing', fase: 1 });
});

module.exports = router;
