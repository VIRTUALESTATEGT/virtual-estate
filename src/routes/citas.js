'use strict';

const express   = require('express');
const router    = express.Router();
const { getSlots } = require('../utils/citas');

// ── Rate limiter en memoria (sin dependencia externa) ─────────────────────────
// 30 req/min por IP para el endpoint público de disponibilidad
const _rl = new Map();
function rateLimiter(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    let rec = _rl.get(key);
    if (!rec || now > rec.reset) rec = { count: 0, reset: now + windowMs };
    rec.count++;
    _rl.set(key, rec);
    if (rec.count > max) {
      return res.status(429).json({ error: 'Demasiadas solicitudes. Intentá en un momento.' });
    }
    next();
  };
}

// ── GET /api/citas/disponibles ────────────────────────────────────────────────
// Público. Devuelve los horarios de inicio disponibles para la fecha y tipo dados.
//
// Query params:
//   fecha  YYYY-MM-DD  obligatorio
//   tipo   visita_propiedades | visita_tecnica   obligatorio
//   m2     número entero   obligatorio si tipo = visita_tecnica
//
// Respuesta exitosa:
//   { fecha, tipo, duracion_minutos, slots: ["10:00", "10:30", ...] }

router.get('/disponibles', rateLimiter(30, 60_000), async (req, res) => {
  const { fecha, tipo, m2 } = req.query;

  if (!fecha || !tipo) {
    return res.status(400).json({ error: 'Parámetros requeridos: fecha, tipo.' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'fecha debe tener formato YYYY-MM-DD.' });
  }
  if (!['visita_propiedades', 'visita_tecnica'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo debe ser visita_propiedades o visita_tecnica.' });
  }
  if (tipo === 'visita_tecnica' && (!m2 || isNaN(parseInt(m2, 10)))) {
    return res.status(400).json({ error: 'Se requiere m2 (número entero) para visita_tecnica.' });
  }

  try {
    const { calcularDuracion } = require('../utils/citas');
    const duracion = calcularDuracion(tipo, m2);
    const slots    = await getSlots(fecha, tipo, m2);
    res.json({ fecha, tipo, duracion_minutos: duracion, slots });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
