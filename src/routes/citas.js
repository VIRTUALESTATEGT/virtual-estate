'use strict';

const express      = require('express');
const jwt          = require('jsonwebtoken');
const router       = express.Router();
const supabase     = require('../config/supabase');
const { calcularDuracion, getSlots, addMinutes, checkSlotConflict } = require('../utils/citas');
const { notifyAdmin } = require('../utils/whatsapp');
const { enviarEmail, registrarEmail, buildEmailBase } = require('../utils/email');
const authMiddleware  = require('../middleware/auth');
const { requireMinRole, requirePortalOrStaff } = require('../middleware/roles');

// ── Rate limiters (en memoria, sin dependencia externa) ───────────────────────
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

// ── Auth opcional (no rechaza si falta token, solo no popula req.usuario) ─────
function optionalAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    try { req.usuario = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET); } catch {}
  }
  next();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Normaliza '10:00:00' o '10:00' → '10:00'
const normTime = t => (t || '').trim().slice(0, 5);

// Fecha legible en español para el mensaje de WhatsApp
function fechaDisplay(isoDate) {
  return new Intl.DateTimeFormat('es-GT', {
    timeZone: 'America/Guatemala',
    weekday: 'long', day: 'numeric', month: 'short',
  }).format(new Date(isoDate + 'T12:00:00Z'));
}

// Enriquece lista de citas con datos básicos de propiedades referenciadas
async function enrichConPropiedades(citas) {
  const allIds = [...new Set(citas.flatMap(c => c.propiedades_ids || []))];
  if (!allIds.length) return citas.map(c => ({ ...c, propiedades: [] }));

  const { data: props } = await supabase
    .from('propiedades')
    .select('id, codigo, nombre, tipo, precio_base')
    .in('id', allIds);

  const propMap = Object.fromEntries((props || []).map(p => [p.id, p]));
  return citas.map(c => ({
    ...c,
    propiedades: (c.propiedades_ids || []).map(id => propMap[id]).filter(Boolean),
  }));
}

// ── Email helper ──────────────────────────────────────────────────────────────
// Envía email al cliente al aprobar o rechazar. Awaitable; nunca lanza.
// Registra el intento (éxito o error) en email_log.

async function _enviarEmailCita(cita, tipoEmail, { notas_admin } = {}) {
  const appUrl = process.env.APP_URL || 'https://www.virtualestategt.com';
  const WA     = 'https://wa.me/50239902399';

  // Fecha larga en español guatemalteco
  const fechaLarga = new Intl.DateTimeFormat('es-GT', {
    timeZone: 'America/Guatemala',
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(cita.fecha + 'T12:00:00Z'));
  const hi = normTime(cita.hora_inicio);
  const hf = normTime(cita.hora_fin);
  const esPropiedad = cita.tipo === 'visita_propiedades';

  let detalleHtml = '';

  if (tipoEmail === 'cita_aprobada') {
    // Propiedades: fetch si aplica
    if (esPropiedad && cita.propiedades_ids?.length) {
      const { data: props } = await supabase
        .from('propiedades').select('codigo, nombre').in('id', cita.propiedades_ids);
      if (props?.length) {
        detalleHtml =
          `<p style="color:#8A9990;font-size:13px;margin:16px 0 6px;font-weight:700;
                     text-transform:uppercase;letter-spacing:.5px;">Propiedades a visitar</p>` +
          `<ul style="margin:0;padding-left:18px;color:#F5F0E8;font-size:14px;line-height:1.9;">` +
          props.map(p => `<li><strong>${p.codigo}</strong> — ${p.nombre}</li>`).join('') +
          `</ul>`;
      }
    } else if (!esPropiedad) {
      const lineas = [];
      if (cita.direccion_tecnica) lineas.push(`<strong>Dirección:</strong> ${cita.direccion_tecnica}`);
      if (cita.m2_aproximados)    lineas.push(`<strong>Área:</strong> ${cita.m2_aproximados} m²`);
      if (lineas.length) {
        detalleHtml =
          `<div style="background:rgba(193,146,89,.07);border-left:3px solid #B09A6C;
                       padding:10px 14px;margin:16px 0;border-radius:0 4px 4px 0;
                       color:#F5F0E8;font-size:14px;line-height:1.8;">` +
          lineas.join('<br>') + `</div>`;
      }
    }

    const cuerpoHtml =
      `<p style="color:#F5F0E8;font-size:15px;margin:0 0 8px;">
         Hola <strong>${cita.nombre_contacto}</strong>,
       </p>
       <p style="color:#8A9990;font-size:14px;line-height:1.7;margin:0 0 20px;">
         Tu visita ha sido <strong style="color:#4F8A3A;">confirmada ✅</strong>.
         Te esperamos en la siguiente fecha:
       </p>
       <div style="background:rgba(79,138,58,.1);border:1px solid rgba(79,138,58,.3);
                   border-radius:6px;padding:14px 18px;margin:0 0 20px;">
         <p style="color:#F5F0E8;font-size:15px;font-weight:700;margin:0;">
           📅 ${fechaLarga}
         </p>
         <p style="color:#B09A6C;font-size:14px;margin:6px 0 0;">
           🕙 ${hi} — ${hf}
         </p>
       </div>
       ${detalleHtml}
       <p style="color:#8A9990;font-size:13px;line-height:1.7;margin:20px 0 0;">
         ¿Necesitás reprogramar o tenés alguna consulta?
         Escribinos por WhatsApp y con gusto te ayudamos.
       </p>`;

    const html = buildEmailBase({
      titulo:    'Tu visita está confirmada ✅',
      subtitulo: 'Virtual Estate GT — Agendamiento de visitas',
      cuerpoHtml,
      ctaTexto: 'Escribir por WhatsApp',
      ctaLink:  WA,
    });

    let estado = 'enviado', errorDetalle = null;
    try {
      await enviarEmail({
        to:      cita.email_contacto,
        subject: `Visita confirmada — ${fechaLarga}, ${hi}`,
        html,
        label:   `cita_aprobada#${cita.id}`,
      });
    } catch (e) {
      estado = 'error';
      errorDetalle = e.message;
      console.error(`[citas] email cita_aprobada #${cita.id} error:`, e.message);
    }
    await registrarEmail({
      destinatario:  cita.email_contacto,
      tipo_email:    'cita_aprobada',
      referencia_id: cita.id,
      estado,
      error_detalle: errorDetalle,
    });

  } else if (tipoEmail === 'cita_rechazada') {

    const notasHtml = notas_admin
      ? `<div style="background:rgba(255,255,255,.04);border-left:3px solid rgba(193,146,89,.5);
                     padding:10px 14px;margin:16px 0;border-radius:0 4px 4px 0;
                     color:#8A9990;font-size:13px;line-height:1.7;">
           ${notas_admin}
         </div>`
      : '';

    const cuerpoHtml =
      `<p style="color:#F5F0E8;font-size:15px;margin:0 0 8px;">
         Hola <strong>${cita.nombre_contacto}</strong>,
       </p>
       <p style="color:#8A9990;font-size:14px;line-height:1.7;margin:0 0 16px;">
         Lamentablemente no pudimos confirmar tu visita solicitada para el
         <strong style="color:#F5F0E8;">${fechaLarga}, ${hi} — ${hf}</strong>.
       </p>
       ${notasHtml}
       <p style="color:#8A9990;font-size:14px;line-height:1.7;margin:16px 0 0;">
         Podés solicitar otra fecha disponible desde el portal o
         escribirnos directamente por WhatsApp.
       </p>`;

    const html = buildEmailBase({
      titulo:    'Sobre tu solicitud de visita',
      subtitulo: 'No pudimos confirmar la fecha solicitada',
      cuerpoHtml,
      ctaTexto: 'Solicitar otra fecha',
      ctaLink:  `${appUrl}/portal-cliente.html`,
    });

    let estado = 'enviado', errorDetalle = null;
    try {
      await enviarEmail({
        to:      cita.email_contacto,
        subject: `Solicitud de visita — ${fechaLarga}`,
        html,
        label:   `cita_rechazada#${cita.id}`,
      });
    } catch (e) {
      estado = 'error';
      errorDetalle = e.message;
      console.error(`[citas] email cita_rechazada #${cita.id} error:`, e.message);
    }
    await registrarEmail({
      destinatario:  cita.email_contacto,
      tipo_email:    'cita_rechazada',
      referencia_id: cita.id,
      estado,
      error_detalle: errorDetalle,
    });
  }
}

// ── GET /api/citas/disponibles ────────────────────────────────────────────────
router.get('/disponibles', rateLimiter(30, 60_000), async (req, res) => {
  const { fecha, tipo, m2 } = req.query;
  if (!fecha || !tipo)
    return res.status(400).json({ error: 'Parámetros requeridos: fecha, tipo.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha))
    return res.status(400).json({ error: 'fecha debe tener formato YYYY-MM-DD.' });
  if (!['visita_propiedades', 'visita_tecnica'].includes(tipo))
    return res.status(400).json({ error: 'tipo debe ser visita_propiedades o visita_tecnica.' });
  if (tipo === 'visita_tecnica' && (!m2 || isNaN(parseInt(m2, 10))))
    return res.status(400).json({ error: 'Se requiere m2 (número entero) para visita_tecnica.' });

  try {
    const duracion = calcularDuracion(tipo, m2);
    const slots    = await getSlots(fecha, tipo, m2);
    res.json({ fecha, tipo, duracion_minutos: duracion, slots });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── POST /api/citas ───────────────────────────────────────────────────────────
// Público (auth opcional para resolver cliente_id). Rate limit: 10/min.
router.post('/', rateLimiter(10, 60_000), optionalAuth, async (req, res) => {
  const {
    tipo, fecha, hora_inicio: rawHora,
    nombre_contacto, email_contacto, telefono_contacto,
    propiedades_ids: rawPropIds,
    m2_aproximados, direccion_tecnica,
    notas_cliente,
  } = req.body;

  // ── Validación básica ────────────────────────────────────────────────────
  if (!tipo || !fecha || !rawHora || !nombre_contacto || !email_contacto)
    return res.status(400).json({ error: 'Campos requeridos: tipo, fecha, hora_inicio, nombre_contacto, email_contacto.' });
  if (!['visita_propiedades', 'visita_tecnica'].includes(tipo))
    return res.status(400).json({ error: 'tipo inválido.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha))
    return res.status(400).json({ error: 'fecha debe tener formato YYYY-MM-DD.' });
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(rawHora))
    return res.status(400).json({ error: 'hora_inicio debe tener formato HH:MM.' });

  // Validación por tipo
  const propiedades_ids = (Array.isArray(rawPropIds) ? rawPropIds : [])
    .map(id => parseInt(id, 10)).filter(id => !isNaN(id));
  const m2 = tipo === 'visita_tecnica' ? parseInt(m2_aproximados, 10) : null;

  if (tipo === 'visita_tecnica' && (!m2 || m2 <= 0))
    return res.status(400).json({ error: 'm2_aproximados requerido para visita_tecnica.' });

  const hora_inicio = normTime(rawHora);

  // ── Validación del slot en el servidor (no confiar en el cliente) ─────────
  let duracion;
  try {
    duracion = calcularDuracion(tipo, m2);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  let slotsLibres;
  try {
    slotsLibres = await getSlots(fecha, tipo, m2);
  } catch (e) {
    return res.status(500).json({ error: 'Error al verificar disponibilidad.' });
  }

  if (!slotsLibres.includes(hora_inicio))
    return res.status(409).json({
      error: 'El horario seleccionado ya no está disponible. Por favor elegí otro slot.',
      slots_disponibles: slotsLibres,
    });

  const hora_fin          = addMinutes(hora_inicio, duracion);
  const reserva_expira_en = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

  // ── Resolver cliente_id si hay token de portal ───────────────────────────
  let cliente_id = null;
  if (req.usuario?.email) {
    const { data: cl } = await supabase
      .from('clientes').select('id').eq('email', req.usuario.email).maybeSingle();
    cliente_id = cl?.id ?? null;
  }

  // ── Insertar cita ────────────────────────────────────────────────────────
  const insert = {
    tipo, estado: 'pendiente',
    fecha, hora_inicio, hora_fin, duracion_minutos: duracion,
    reserva_expira_en,
    cliente_id,
    nombre_contacto: nombre_contacto.trim(),
    email_contacto:  email_contacto.trim(),
    telefono_contacto: (telefono_contacto || '').trim() || null,
    propiedades_ids,
    m2_aproximados: m2 || null,
    direccion_tecnica: (direccion_tecnica || '').trim() || null,
    notas_cliente: (notas_cliente || '').trim() || null,
  };

  const { data: cita, error: insErr } = await supabase
    .from('citas').insert([insert]).select().maybeSingle();
  if (insErr) return res.status(500).json({ error: insErr.message });

  // ── Notificación al admin por WhatsApp ───────────────────────────────────
  try {
    const tipoLabel = tipo === 'visita_propiedades' ? 'Visita a propiedades' : 'Visita técnica / escaneo';
    const durLabel  = `${duracion} min`;
    let detalle = '';

    if (tipo === 'visita_propiedades' && propiedades_ids.length) {
      const { data: props } = await supabase
        .from('propiedades').select('codigo, nombre').in('id', propiedades_ids);
      detalle = (props || []).map(p => `• ${p.codigo} — ${p.nombre}`).join('\n');
    } else if (tipo === 'visita_tecnica') {
      detalle = `• ${m2} m²${direccion_tecnica ? '\n• ' + direccion_tecnica : ''}`;
    }

    const msg =
      `🗓 Nueva solicitud de visita\n\n` +
      `Tipo: ${tipoLabel} (${durLabel})\n` +
      `📅 ${fechaDisplay(fecha)}  ·  ${hora_inicio}–${hora_fin}\n` +
      (detalle ? `\n${detalle}\n` : '') +
      `\nSolicitante: ${nombre_contacto}` +
      `\n📧 ${email_contacto}` +
      (telefono_contacto ? `\n📞 ${telefono_contacto}` : '') +
      (notas_cliente ? `\nNotas: ${notas_cliente}` : '');

    await notifyAdmin(msg);
  } catch {}  // notificación no bloquea la respuesta

  res.status(201).json(cita);
});

// ── GET /api/citas ────────────────────────────────────────────────────────────
// Admin. Filtros opcionales: estado, fecha, tipo.
router.get('/', authMiddleware, requireMinRole('asistente'), async (req, res) => {
  try {
    let q = supabase
      .from('citas')
      .select('*')
      .order('fecha', { ascending: true })
      .order('hora_inicio', { ascending: true });

    if (req.query.estado) q = q.eq('estado', req.query.estado);
    if (req.query.fecha)  q = q.eq('fecha',  req.query.fecha);
    if (req.query.tipo)   q = q.eq('tipo',   req.query.tipo);

    const { data, error } = await q;
    if (error) throw error;

    const enriched = await enrichConPropiedades(data || []);
    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/citas/me ─────────────────────────────────────────────────────────
// Cliente autenticado: sus propias citas.
router.get('/me', authMiddleware, requirePortalOrStaff('asistente'), async (req, res) => {
  try {
    const { data: cliente } = await supabase
      .from('clientes').select('id').eq('email', req.usuario.email).maybeSingle();
    if (!cliente) return res.json([]);

    const { data, error } = await supabase
      .from('citas')
      .select('*')
      .eq('cliente_id', cliente.id)
      .order('fecha', { ascending: false });
    if (error) throw error;

    const enriched = await enrichConPropiedades(data || []);
    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/citas/:id/aprobar ──────────────────────────────────────────────
// Admin. Revalida que el slot siga libre antes de aprobar.
router.patch('/:id/aprobar', authMiddleware, requireMinRole('asistente'), async (req, res) => {
  const { id } = req.params;
  try {
    const { data: cita, error: fetchErr } = await supabase
      .from('citas').select('*').eq('id', id).maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!cita) return res.status(404).json({ error: 'Cita no encontrada.' });
    if (cita.estado !== 'pendiente')
      return res.status(400).json({ error: `No se puede aprobar una cita en estado "${cita.estado}".` });

    // Revalidar: ¿el slot sigue libre frente a citas ya APROBADAS?
    const conflicto = await checkSlotConflict(
      cita.fecha, cita.hora_inicio, cita.hora_fin, cita.id
    );
    if (conflicto) {
      return res.status(409).json({
        error: 'No se puede aprobar: el slot choca con otra cita ya aprobada.',
        conflicto: {
          id:             conflicto.id,
          nombre:         conflicto.nombre_contacto,
          tipo:           conflicto.tipo,
          hora_inicio:    conflicto.hora_inicio,
          hora_fin:       conflicto.hora_fin,
        },
      });
    }

    const { data: updated, error: upErr } = await supabase
      .from('citas')
      .update({ estado: 'aprobada', reserva_expira_en: null })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (upErr) throw upErr;

    // Email al cliente — awaited (Lambda muere al responder), nunca bloquea la respuesta
    await _enviarEmailCita(updated, 'cita_aprobada');

    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/citas/:id/rechazar ─────────────────────────────────────────────
// Admin.
router.patch('/:id/rechazar', authMiddleware, requireMinRole('asistente'), async (req, res) => {
  const { id } = req.params;
  const { notas_admin } = req.body;
  try {
    const { data: cita } = await supabase
      .from('citas').select('estado').eq('id', id).maybeSingle();
    if (!cita) return res.status(404).json({ error: 'Cita no encontrada.' });
    if (!['pendiente', 'aprobada'].includes(cita.estado))
      return res.status(400).json({ error: `No se puede rechazar una cita en estado "${cita.estado}".` });

    const update = { estado: 'rechazada' };
    if (notas_admin !== undefined) update.notas_admin = notas_admin;

    const { data: updated, error } = await supabase
      .from('citas').update(update).eq('id', id).select().maybeSingle();
    if (error) throw error;

    // Email al cliente — awaited (Lambda muere al responder), nunca bloquea la respuesta
    await _enviarEmailCita(updated, 'cita_rechazada', { notas_admin: updated.notas_admin });

    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/citas/:id/cancelar ────────────────────────────────────────────
// Admin o el cliente dueño de la cita.
router.patch('/:id/cancelar', authMiddleware, requirePortalOrStaff('asistente'), async (req, res) => {
  const { id } = req.params;
  try {
    const { data: cita } = await supabase
      .from('citas').select('id, estado, cliente_id, email_contacto').eq('id', id).maybeSingle();
    if (!cita) return res.status(404).json({ error: 'Cita no encontrada.' });
    if (['cancelada', 'completada', 'rechazada'].includes(cita.estado))
      return res.status(400).json({ error: `La cita ya está en estado "${cita.estado}".` });

    // Si es cliente, verificar que sea el dueño
    const userRole = req.usuario?.role || req.usuario?.rol;
    if (userRole === 'cliente') {
      const { data: cl } = await supabase
        .from('clientes').select('id').eq('email', req.usuario.email).maybeSingle();
      if (!cl || cl.id !== cita.cliente_id)
        return res.status(403).json({ error: 'Solo podés cancelar tus propias citas.' });
    }

    const { data: updated, error } = await supabase
      .from('citas').update({ estado: 'cancelada' }).eq('id', id).select().maybeSingle();
    if (error) throw error;

    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
