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

// ── Welcome email — fire-and-forget, never throws ────────────────────────────
async function _enviarBienvenida(nombre, email, usuarioId) {
  const { enviarEmail, registrarEmail, yaSeEnvio, buildEmailBase } = require('../utils/email');
  const fs   = require('fs');
  const path = require('path');

  // Deduplication: skip if already sent
  if (await yaSeEnvio({ destinatario: email, tipo_email: 'bienvenida', referencia_id: usuarioId })) {
    console.log('[bienvenida] ya enviado a', email, '— omitiendo');
    return;
  }

  // Unsubscribe token (needed for footer — relational email, not transactional)
  const { data: clienteRow } = await supabase
    .from('clientes').select('unsubscribe_token').eq('email', email).maybeSingle();
  const unsubscribeToken = clienteRow?.unsubscribe_token || null;

  // Optional PDF attachment — if file doesn't exist, email sends without it
  const attachments = [];
  const guiaPath = path.join(process.cwd(), 'public', 'assets', 'guia-cliente.pdf');
  try {
    if (fs.existsSync(guiaPath)) {
      attachments.push({ filename: 'Guia-Portal-Virtual-Estate.pdf',
                         content:  fs.readFileSync(guiaPath),
                         contentType: 'application/pdf' });
    } else {
      console.log('[bienvenida] guia-cliente.pdf no encontrada — enviando sin adjunto');
    }
  } catch (e) {
    console.warn('[bienvenida] error leyendo guía PDF:', e.message, '— enviando sin adjunto');
  }

  const _row = (icon, titulo, desc) =>
    `<tr>
      <td style="padding:10px 12px;vertical-align:top;font-size:18px;width:32px;">${icon}</td>
      <td style="padding:10px 12px 10px 0;vertical-align:top;border-bottom:1px solid rgba(193,146,89,.08);">
        <div style="font-size:13px;font-weight:700;color:#F5F0E8;margin-bottom:2px;">${titulo}</div>
        <div style="font-size:12px;color:#8A9990;line-height:1.55;">${desc}</div>
      </td>
    </tr>`;

  const cuerpoHtml = `
    <p style="font-size:16px;font-weight:700;color:#F5F0E8;margin:0 0 6px;">¡Hola ${nombre}! 👋</p>
    <p style="font-size:13px;color:#8A9990;line-height:1.65;margin:0 0 18px;">
      Tu perfil en Virtual Estate GT está listo. Esto es todo lo que puedes hacer desde tu portal:
    </p>

    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tbody>
        ${_row('📋', 'Mis cotizaciones',
          'Ve el estado de todas tus cotizaciones de servicios, descárgalas en PDF y confirma tu anticipo.')}
        ${_row('📐', 'Tours 3D y escaneos',
          'Accede a tus tours virtuales e inmersivos en cualquier momento desde cualquier dispositivo.')}
        ${_row('🏠', 'Propiedades guardadas',
          'Explora nuestro portafolio, guarda las propiedades que te interesan y compáralas en tu carrito.')}
        ${_row('💳', 'Historial de pagos',
          'Registra tus anticipos, revisa el historial de pagos y el resumen de cada transacción.')}
        ${_row('🤝', 'Programa de agentes referidos',
          'Solicita tu código de agente, recomienda nuestros servicios y gana comisiones por cada proyecto cerrado que refieras. Tu comisión sale de la comisión interna de VE — el cliente siempre paga el mismo precio.')}
        ${_row('🔗', 'Vinculaciones y comisiones',
          'Ve qué proyectos han usado tu código de referido, el historial de vinculaciones y el estado de tus comisiones pendientes o pagadas.')}
        ${_row('👤', 'Tu perfil',
          'Actualiza tus datos, pronombre, teléfono y cuenta bancaria para recibir comisiones.')}
        ${_row('🛡️', 'Verificación de identidad',
          'Completa tu verificación para activar tu código de agente y acceder a funciones avanzadas.')}
      </tbody>
    </table>

    <p style="font-size:12px;color:#8A9990;line-height:1.6;margin:0;border-top:1px solid rgba(193,146,89,.12);padding-top:14px;">
      Si confirmaste una cotización anteriormente con este correo, ya puedes verla en tu portal al iniciar sesión.
    </p>

    <div style="margin-top:20px;border-top:1px solid rgba(193,146,89,.12);padding-top:18px;">
      <a href="https://virtualestategt.com/documentos/guia-portal-cliente.pdf"
         target="_blank"
         style="display:block;background:#B8860B;color:#ffffff;padding:14px 20px;border-radius:4px;text-decoration:none;font-weight:700;font-size:14px;text-align:center;letter-spacing:.3px;margin-bottom:14px;">
        📘 Descargar Guía del Portal
      </a>
      <p style="font-size:12px;color:#8A9990;line-height:1.6;margin:0 0 10px;">
        Al utilizar nuestro portal, confirmas que has leído y aceptas lo indicado en estos documentos. Si tienes alguna objeción, contáctanos de inmediato.
      </p>
      <p style="font-size:11px;color:#6A7A6F;margin:0;text-align:center;">
        <a href="https://virtualestategt.com/documentos/terminos-y-condiciones.pdf" target="_blank" style="color:#6A7A6F;text-decoration:underline;">Términos y Condiciones</a>
        &nbsp;·&nbsp;
        <a href="https://virtualestategt.com/documentos/politica-de-privacidad.pdf" target="_blank" style="color:#6A7A6F;text-decoration:underline;">Política de Privacidad</a>
      </p>
    </div>`;

  const html = buildEmailBase({
    titulo:          '¡Bienvenido a Virtual Estate GT!',
    subtitulo:       `Tu cuenta está lista, ${nombre}.`,
    cuerpoHtml,
    ctaTexto:        'Ir a mi portal',
    ctaLink:         'https://www.virtualestategt.com/portal.html',
    unsubscribeToken,
  });

  let estado = 'enviado', errorDetalle = null;
  try {
    await enviarEmail({
      to:          email,
      subject:     '¡Bienvenido a Virtual Estate GT! Tu portal está listo 🏠',
      html,
      attachments: attachments.length ? attachments : undefined,
      label:       'bienvenida',
    });
  } catch (e) {
    console.error('[bienvenida] enviarEmail error:', e.message);
    estado = 'error'; errorDetalle = e.message;
  }

  await registrarEmail({ destinatario: email, tipo_email: 'bienvenida',
    referencia_id: usuarioId, estado, error_detalle: errorDetalle });
}

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

    // Fire-and-forget welcome email — response already sent, never blocks registration
    _enviarBienvenida(usuario.nombre, usuario.email, usuario.id).catch(e =>
      console.error('[bienvenida] uncaught:', e.message)
    );
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
