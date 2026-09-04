require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const crypto = require('crypto');

const app = express();
const authMiddleware = require('./src/middleware/auth');
const { checkRateLimit: checkRL, recordAttempt } = require('./src/utils/rateLimit');
const { maskPhone } = require('./src/utils/mask');

const RL_LEADS_PUBLIC = { max: 10, windowMs: 60 * 60 * 1000 }; // 10 / hora

// Security headers — CSP disabled until admin.html JS is externalized
app.use(helmet({ contentSecurityPolicy: false }));

// CORS — restrictive whitelist.
// Requests without Origin (server-to-server: webhooks, curl, crons) are always allowed.
// In production all browser calls are same-origin (API_URL=''), so CORS rarely fires at all.
const _CORS_ORIGINS = [
  'https://virtualestategt.com',
  'https://www.virtualestategt.com',
];
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);                                    // server-to-server
    if (origin.endsWith('.vercel.app')) return cb(null, true);             // Vercel previews
    if (process.env.NODE_ENV === 'development' &&
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
      return cb(null, true);                                               // dev local
    if (_CORS_ORIGINS.includes(origin)) return cb(null, true);            // production
    cb(Object.assign(new Error('CORS: origin not allowed'), { status: 403 }));
  },
  credentials: true,
}));

// Capture raw body via express.json verify — single stream read, available to all webhook
// signature validators (WhatsApp uses req.rawBody as string; Instagram as Buffer — both work
// with crypto.createHmac().update())
app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// ── Public: warmup / health check — registered FIRST, before any auth ─────────
// Registered on both /health and /api/health: Vercel may or may not strip the
// /api prefix before Express sees req.url — both forms are covered.
// url field in response reveals which path Express actually received.
const supabasePublic = require('./src/config/supabase');
app.get(['/health', '/api/health'], async (req, res) => {
  // MUST await the Supabase query — fire-and-forget doesn't keep the socket alive.
  // The point of this endpoint is to warm BOTH the Lambda AND the Supabase connection.
  try {
    await supabasePublic.from('conversaciones_multicanal').select('id').limit(1);
    res.json({ ok: true, db: 'ok', url: req.url, t: new Date().toISOString() });
  } catch (e) {
    // Still return 200 so warmup pings don't alert on transient Supabase issues
    res.json({ ok: true, db: 'error', error: e.message, url: req.url, t: new Date().toISOString() });
  }
});

// Auth (pública — sin protección)
const authRouter = require('./src/routes/auth');
app.use('/api/auth', authRouter);

const DISP_ALLOWED = new Set(['vacia', 'habitada', 'airbnb', 'en_construccion']);
const MOD_ALLOWED  = new Set(['venta', 'renta']);

app.get('/api/propiedades/public', async (req, res) => {
  try {
    const { zona, tipo, modalidad, precio_min, precio_max, m2_min, m2_max, disponibilidad } = req.query;
    const dispVals = disponibilidad
      ? disponibilidad.split(',').map(v => v.trim()).filter(v => DISP_ALLOWED.has(v))
      : [];
    const modVals = modalidad
      ? modalidad.split(',').map(v => v.trim()).filter(v => MOD_ALLOWED.has(v))
      : [];
    const applyFilters = (q) => {
      if (zona)            q = q.ilike('zona', `%${zona}%`);
      if (tipo)            q = q.eq('tipo', tipo);
      if (modVals.length)  q = q.overlaps('modalidad', modVals);
      if (precio_min)      q = q.gte('precio', Number(precio_min));
      if (precio_max)      q = q.lte('precio', Number(precio_max));
      if (m2_min)          q = q.gte('m2', Number(m2_min));
      if (m2_max)          q = q.lte('m2', Number(m2_max));
      if (dispVals.length) q = q.overlaps('disponibilidad', dispVals);
      return q;
    };
    // Try with adicionales join first; fall back to base select if table doesn't exist yet
    let { data, error } = await applyFilters(
      supabasePublic.from('propiedades')
        .select('id,nombre,tipo,modalidad,precio,m2,zona,linktour3d,disponibilidad,propiedades_adicionales(tipo,nombre)')
        .order('id', { ascending: false })
    );
    if (error && error.message && error.message.includes('propiedades_adicionales')) {
      ({ data, error } = await applyFilters(
        supabasePublic.from('propiedades')
          .select('id,nombre,tipo,modalidad,precio,m2,zona,linktour3d,disponibilidad')
          .order('id', { ascending: false })
      ));
    }
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/leads/public', async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  try {
    const rl = await checkRL(ip, 'leads-public', RL_LEADS_PUBLIC.max, RL_LEADS_PUBLIC.windowMs);
    if (rl.blocked)
      return res.status(429).json({ error: 'Demasiados mensajes enviados. Esperá una hora e intentá de nuevo.' });

    const { nombre, apellido, email, telefono, empresa, servicio, fuente, seguimiento, mensaje } = req.body;
    if (!nombre || (!email && !telefono))
      return res.status(400).json({ error: 'Nombre y correo o teléfono son requeridos' });

    await recordAttempt(ip, 'leads-public', RL_LEADS_PUBLIC.windowMs);

    const { data, error } = await supabasePublic
      .from('leads')
      .insert([{
        nombre,
        apellido:   apellido   || null,
        email:      email      || null,
        telefono:   telefono   || null,
        empresa:    empresa    || mensaje || null,
        servicio:   servicio   || null,
        fuente:     fuente     || 'web',
        seguimiento: seguimiento || null,
        estado: 'Nuevo',
      }])
      .select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Public: Instagram DM webhook (no auth) ───────────────────────
const webhookIGRouter = require('./src/routes/webhook-instagram');
app.use('/api/instagram/webhook', webhookIGRouter);

// ── Meta token management (cron-protected) ───────────────────────
const metaTokensRouter = require('./src/routes/meta-tokens');
app.use('/api/meta', metaTokensRouter);

// ── Public: Cotización confirmation portal (no auth — leads access via email link) ──
const confirmacionRouter = require('./src/routes/confirmacion');
app.use('/api/confirmacion', confirmacionRouter);
app.use('/api/cron', confirmacionRouter);

// ── Public: Email unsubscribe (no auth — client clicks from email link) ──────
const unsubscribeRouter = require('./src/routes/unsubscribe');
app.use('/api/unsubscribe', unsubscribeRouter);

// ── Public: zone list, quote generation, and price list ──────────
const cotizacionGenRouter = require('./src/routes/cotizacion-gen');
// GET /api/cotizacion/* public; PUT/POST/DELETE /api/cotizacion/precios* admin-only
app.use('/api/cotizacion', (req, res, next) => {
  const isWrite = ['PUT','POST','DELETE'].includes(req.method) && req.path.startsWith('/precios');
  if (isWrite) return authMiddleware(req, res, () => requireMinRole('gerente')(req, res, next));
  next();
}, cotizacionGenRouter);

// ── Rutas protegidas con JWT ──────────────────────────────────────
const leadsRouter = require('./src/routes/leads');
const clientesRouter = require('./src/routes/clientes');
const propiedadesRouter = require('./src/routes/propiedades');
const proyectosRouter = require('./src/routes/proyectos');
const cotizacionesRouter = require('./src/routes/cotizaciones');
const agentesRouter = require('./src/routes/agentes');
const { router: usuariosRouter } = require('./src/routes/usuarios');
const agenteIARouter = require('./src/routes/agente-ia');
const conversacionesRouter = require('./src/routes/conversaciones');
const verificacionRouter = require('./src/routes/verificacion');
const agenteSolicitudRouter  = require('./src/routes/agente-solicitud');
const marketingAgent         = require('./src/routes/marketing-agent');
const marketingRouter        = require('./src/routes/marketing');
const imageGallery           = require('./src/routes/image-gallery');

const { requireMinRole, requirePortalOrStaff, requireSuperadmin } = require('./src/middleware/roles');

app.use('/api/leads',         authMiddleware, requireMinRole('asistente'), leadsRouter);
app.use('/api/clientes',      authMiddleware, requirePortalOrStaff('asistente'), clientesRouter);
app.use('/api/propiedades',   authMiddleware, requireMinRole('asistente'), propiedadesRouter);
app.use('/api/proyectos',     authMiddleware, requireMinRole('asistente'), proyectosRouter);
app.use('/api/cotizaciones',  authMiddleware, requireMinRole('asistente'), cotizacionesRouter);
app.use('/api/marketing',    authMiddleware, requireMinRole('gerente'),   marketingAgent);
app.use('/api/mkt',          authMiddleware, requireMinRole('gerente'),   marketingRouter);
app.use('/api/gallery',      authMiddleware, requireMinRole('gerente'),   imageGallery);
app.use('/api/agentes',       authMiddleware, requireMinRole('gerente'),   agentesRouter);
const constructoresRouter = require('./src/routes/constructores');
app.use('/api/constructores', authMiddleware, requireMinRole('asistente'), constructoresRouter);
app.use('/api/usuarios',      authMiddleware, requireSuperadmin,           usuariosRouter);
app.use('/api/agente-ia',     authMiddleware, requireMinRole('asistente'), agenteIARouter);
app.use('/api/conversaciones',authMiddleware, requireMinRole('asistente'), conversacionesRouter);
app.use('/api/cliente/verificacion-identidad', authMiddleware, requirePortalOrStaff('asistente'), verificacionRouter);
// Agent applications: /solicitud* = portal clients; /solicitudes* = admin (gerente+)
app.use('/api/agente', authMiddleware, (req, res, next) => {
  if (req.path === '/solicitud' || req.path.startsWith('/solicitud/'))
    return requirePortalOrStaff('asistente')(req, res, next);
  return requireMinRole('gerente')(req, res, next);
}, agenteSolicitudRouter);

// ── Public: WhatsApp webhook (must be before the /api auth catch-all below) ──
app.get('/api/whatsapp/webhook',  _waWebhookVerify);
app.post('/api/whatsapp/webhook', _waWebhookPost);

// ── WA Contacts CRUD ─────────────────────────────────────────────────────────
app.get('/api/wa-contacts', authMiddleware, requireMinRole('asistente'), async (req, res) => {
  try {
    const { buscar, tipo } = req.query;
    let q = supabasePublic.from('whatsapp_contacts')
      .select('phone_number, contact_type, name, respond, created_at, updated_at')
      .order('updated_at', { ascending: false });
    if (buscar) q = q.ilike('phone_number', `%${buscar}%`);
    if (tipo)   q = q.eq('contact_type', tipo);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/wa-contacts', authMiddleware, requireMinRole('asistente'), async (req, res) => {
  try {
    const { phone_number, contact_type, name } = req.body;
    if (!phone_number || !contact_type) return res.status(400).json({ error: 'phone_number y contact_type son requeridos' });
    if (!['client', 'personal', 'owner'].includes(contact_type)) return res.status(400).json({ error: 'contact_type inválido' });
    const phoneNorm = normalizarNumero(phone_number);
    const respond   = contact_type !== 'personal';
    const { data, error } = await supabasePublic.from('whatsapp_contacts')
      .upsert({ phone_number: phoneNorm, contact_type, name: name || null, respond, updated_at: new Date() },
               { onConflict: 'phone_number' })
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/wa-contacts/:phone', authMiddleware, requireMinRole('asistente'), async (req, res) => {
  try {
    const phoneNorm = normalizarNumero(req.params.phone);
    const { error } = await supabasePublic.from('whatsapp_contacts').delete().eq('phone_number', phoneNorm);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/wa-contacts/import-vcard', authMiddleware, requireMinRole('asistente'), async (req, res) => {
  try {
    const vcf = req.body?.vcf;
    if (!vcf || typeof vcf !== 'string') return res.status(400).json({ error: 'Body debe tener { vcf: "contenido .vcf" }' });

    // Parse all contacts and collect valid normalized phone numbers (deduplicated)
    const parsed  = parseVCards(vcf);
    const seen    = new Set();
    const entries = [];
    for (const { name, phones } of parsed) {
      for (const raw of phones) {
        const norm = normalizarNumero(raw);
        if (norm.length < 7 || seen.has(norm)) continue; // too short or duplicate
        seen.add(norm);
        entries.push({ phone: norm, name: name || null });
      }
    }

    if (!entries.length) return res.json({ agregados: 0, omitidos_cliente: 0, ya_existian: 0, total_procesados: 0 });

    // Fetch existing contacts in chunks of 200 to stay within URL limits
    const existingMap = new Map();
    const allPhones   = entries.map(e => e.phone);
    for (let i = 0; i < allPhones.length; i += 200) {
      const { data } = await supabasePublic.from('whatsapp_contacts')
        .select('phone_number, contact_type')
        .in('phone_number', allPhones.slice(i, i + 200));
      if (data) data.forEach(r => existingMap.set(r.phone_number, r.contact_type));
    }

    let agregados = 0, omitidos_cliente = 0, ya_existian = 0;
    const toInsert = [];
    for (const { phone, name } of entries) {
      const existing = existingMap.get(phone);
      if (existing === 'client')  { omitidos_cliente++; }      // never overwrite a real client
      else if (existing)          { ya_existian++; }            // personal/owner — leave as-is
      else { toInsert.push({ phone_number: phone, contact_type: 'personal', respond: false, name }); agregados++; }
    }

    // Batch insert in groups of 50
    for (let i = 0; i < toInsert.length; i += 50) {
      const { error } = await supabasePublic.from('whatsapp_contacts').insert(toInsert.slice(i, i + 50));
      if (error) throw error;
    }

    res.json({ agregados, omitidos_cliente, ya_existian, total_procesados: entries.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Envío de cotizaciones por canal ──────────────────────────────────────────
const envioCotizacionRouter = require('./src/routes/envio-cotizacion');
app.use('/api', authMiddleware, requireMinRole('asistente'), envioCotizacionRouter);

// Notificaciones admin (inline — simple read/list endpoint)
app.get('/api/notificaciones', authMiddleware, requireMinRole('asistente'), async (req, res) => {
  const supabase = require('./src/config/supabase');
  try {
    const { estado } = req.query;
    let q = supabase.from('notificaciones_admin').select('*').order('timestamp', { ascending: false }).limit(50);
    if (estado) q = q.eq('estado', estado);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// HTML estático → editar en public/. Express solo maneja rutas con lógica.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/portal/cotizacion/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'portal', 'cotizacion.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));

app.get('/terms', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Términos de Servicio — Virtual Estate GT</title><style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 24px;color:#1a1a1a;line-height:1.7}h1{color:#2D5016}h2{color:#2D5016;font-size:1.1rem;margin-top:2rem}a{color:#2D5016}footer{margin-top:3rem;padding-top:1rem;border-top:1px solid #ddd;font-size:.85rem;color:#666}</style></head><body><h1>Términos de Servicio</h1><p><strong>Virtual Estate GT</strong> — Última actualización: mayo 2026</p><h2>1. Aceptación de términos</h2><p>Al utilizar los servicios de Virtual Estate GT, usted acepta estos términos. Si no está de acuerdo, por favor no utilice nuestros servicios.</p><h2>2. Descripción del servicio</h2><p>Virtual Estate GT ofrece servicios de fotografía inmobiliaria profesional, escaneo 3D, tours virtuales y producción de contenido visual para el sector inmobiliario en Guatemala.</p><h2>3. Uso aceptable</h2><p>Usted se compromete a utilizar nuestros servicios únicamente para fines legales y a no reproducir, distribuir o utilizar comercialmente el contenido producido por Virtual Estate GT sin autorización escrita previa.</p><h2>4. Propiedad intelectual</h2><p>Todo el contenido producido por Virtual Estate GT (fotografías, modelos 3D, videos) es propiedad de Virtual Estate GT hasta la entrega y pago completo del servicio contratado, momento en que los derechos de uso se transfieren al cliente según lo acordado.</p><h2>5. Pagos y cancelaciones</h2><p>Los términos de pago, anticipos y políticas de cancelación se establecen en la cotización o contrato individual de cada proyecto.</p><h2>6. Limitación de responsabilidad</h2><p>Virtual Estate GT no será responsable por daños indirectos, incidentales o consecuentes derivados del uso de nuestros servicios más allá del monto pagado por el servicio específico.</p><h2>7. Modificaciones</h2><p>Nos reservamos el derecho de modificar estos términos en cualquier momento. Los cambios serán publicados en esta página.</p><h2>8. Contacto</h2><p>Para consultas sobre estos términos: <a href="mailto:info@virtualestategt.com">info@virtualestategt.com</a></p><footer><a href="/">← Volver al inicio</a> &nbsp;|&nbsp; <a href="/privacy">Política de Privacidad</a></footer></body></html>`);
});

// Assets estáticos (imágenes, documentos)
app.use('/assets',    express.static(path.join(__dirname, 'public', 'assets'), { dotfiles: 'ignore' }));
app.use('/assets',    express.static(path.join(__dirname, 'images', 'assets'), { dotfiles: 'ignore' }));
app.use('/images',    express.static(path.join(__dirname, 'images'),    { dotfiles: 'ignore' }));
app.use('/documentos',express.static(path.join(__dirname, 'documentos'),{ dotfiles: 'ignore' }));
app.use('/vendor',    express.static(path.join(__dirname, 'public', 'vendor'), { dotfiles: 'ignore' }));

// ============================================================
// WHATSAPP WEBHOOK — Meta Business API
// ============================================================

const _waSupabase = require('./src/config/supabase');

async function _waGenerateResponse(phone, userMessage) {
  console.log('[WA] _waGenerateResponse — CLAUDE_API_KEY present:', !!process.env.CLAUDE_API_KEY, '— key prefix:', (process.env.CLAUDE_API_KEY || '').slice(0, 10));
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const { TOOL_CREAR_COTIZACION, ejecutarCrearCotizacion,
            TOOL_ESCALAR_HUMANO,  ejecutarEscalarHumano   } = require('./src/config/tools-cotizacion');

    const { data: history } = await _waSupabase
      .from('whatsapp_messages')
      .select('message, direction')
      .eq('phone_number', phone)
      .order('timestamp', { ascending: false })
      .limit(10);

    console.log('[WA] _waGenerateResponse — history rows:', (history || []).length);

    const historyMessages = (history || []).reverse().map(m => ({
      role: m.direction === 'incoming' ? 'user' : 'assistant',
      content: m.message
    }));
    historyMessages.push({ role: 'user', content: userMessage });

    const { buildSystemPrompt } = require('./src/config/system-prompt');
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: buildSystemPrompt('whatsapp', ''),
      messages: historyMessages,
      tools: [TOOL_CREAR_COTIZACION, TOOL_ESCALAR_HUMANO],
    });

    const textBlock    = response.content.find(b => b.type === 'text');
    const toolUseBlock = response.content.find(b => b.type === 'tool_use');

    // ── Dispatcher de tools — despacha por nombre (preparado para múltiples tools) ──

    if (toolUseBlock?.name === 'crear_cotizacion_borrador') {
      const nombreCliente = toolUseBlock.input?.nombre || 'cliente';
      console.log('[COTIZACION] El agente llamó la tool:', toolUseBlock.name);
      console.log('[COTIZACION] Con estos datos:', JSON.stringify(toolUseBlock.input));
      console.log('[COTIZACION] stop_reason:', response.stop_reason);
      try {
        const resultado = await ejecutarCrearCotizacion(toolUseBlock.input, null);
        console.log('[COTIZACION] resultado:', resultado.exito ? 'exito' : 'error',
          '| cotizacion_id:', resultado.cotizacion_id,
          '| monto:', resultado.monto,
          resultado.error ? '| error: ' + resultado.error : '');
        if (resultado.exito) {
          return `¡Perfecto, ${nombreCliente}! 🙌 Tu solicitud de cotización quedó registrada. Nuestro equipo la revisará y te la hará llegar muy pronto por este medio. 😊 Si tienes alguna duda mientras tanto, con gusto te ayudo.`;
        }
      } catch (e) {
        console.error('[COTIZACION] ejecutarCrearCotizacion excepción:', e.message);
      }
      return `¡Gracias, ${nombreCliente}! Hemos recibido tus datos. Nuestro equipo se pondrá en contacto contigo muy pronto para darte tu cotización. 😊`;
    }

    if (toolUseBlock?.name === 'escalar_a_humano') {
      console.log('[HANDOFF] El agente escaló a humano:', JSON.stringify(toolUseBlock.input));
      // Fire-and-forget — no bloqueamos la respuesta al cliente
      ejecutarEscalarHumano(toolUseBlock.input, phone).catch(e =>
        console.error('[HANDOFF] ejecutarEscalarHumano error:', e.message)
      );
      // Devuelve el texto conversacional de Claude (sigue atendiendo al cliente)
      return textBlock?.text
        ?? 'Con gusto traslado tu consulta a uno de nuestros encargados, quien te atenderá personalmente en cuanto le sea posible. Mientras tanto, sigo aquí para cualquier otra duda que tengas. 😊';
    }

    if (toolUseBlock) {
      // Nombre de tool no reconocido — defensivo: no ejecutar nada
      console.warn('[WA] tool_use no reconocida:', toolUseBlock.name, '— devolviendo texto de Claude');
      return textBlock?.text ?? 'En este momento no puedo responder. Por favor intenta de nuevo en unos instantes.';
    }

    // Conversación normal — devuelve el texto de Claude
    const textOut = textBlock?.text ?? null;
    if (textOut) return textOut;

    return 'En este momento no puedo responder. Por favor intenta de nuevo en unos instantes.';
  } catch (e) {
    console.error('[WA] _waGenerateResponse ERROR:', e.message);
    throw e;
  }
}

async function _waSendMessage(phone, message) {
  const axios = require('axios');
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token   = process.env.WHATSAPP_ACCESS_TOKEN;
  console.log('[WA] _waSendMessage — phoneId:', phoneId, '— token present:', !!token, '— token prefix:', (token || '').slice(0, 15));

  if (!phoneId || !token || token === 'pendiente_cuando_meta_apruebe') {
    console.log('[WA] _waSendMessage — ABORTADO: credenciales faltantes o token pendiente');
    return;
  }

  try {
    const result = await axios.post(
      `https://graph.facebook.com/v18.0/${phoneId}/messages`,
      { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: message } },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    console.log('[WA] _waSendMessage — respuesta Meta:', JSON.stringify(result.data));
  } catch (e) {
    const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    console.error('[WA] _waSendMessage ERROR:', detail);
    throw e;
  }
}

// GET — verificación del webhook por Meta
function _waWebhookVerify(req, res) {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('[WhatsApp] Webhook verificado');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
}

// POST — recibir mensajes entrantes
const WA_OWNER_NUMBERS = ['50239902399', '50250175832'];
const WA_SIG_ENFORCE   = process.env.WA_SIGNATURE_ENFORCE === 'true';

function validateWASignature(req) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return { valid: true, reason: 'no_secret_configured' };
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return { valid: false, reason: 'missing_header' };
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(req.rawBody || '')
    .digest('hex');
  const valid = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  return { valid, received: sig, expected };
}

// Normaliza un número de teléfono al formato canónico usado en whatsapp_contacts.
// Meta envía sin '+' ni guiones ('50239902399'), pero el owner puede escribir
// comandos con cualquier formato — esta función los unifica.
function normalizarNumero(raw) {
  const digits = String(raw || '').replace(/\D/g, ''); // quita todo excepto dígitos
  if (digits.length === 8) return '502' + digits;       // número local GT → prefijo 502
  return digits;                                         // 11 dígitos (502xxxxxxxx) u otros → sin cambio
}

// Parsea contenido vCard (RFC 6350) — soporta múltiples contactos por archivo,
// líneas plegadas (folded), y el formato item1.TEL de exportaciones de iCloud/iOS.
function parseVCards(vcfText) {
  const contacts = [];
  const unfolded = String(vcfText).replace(/\r?\n[ \t]/g, ''); // unfold folded lines
  const blocks   = unfolded.split(/BEGIN:VCARD/i).slice(1);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    let name = null;
    const phones = [];

    for (const line of lines) {
      if (/^END:VCARD/i.test(line.trim())) break;

      // FN:Display Name (may have params: FN;CHARSET=UTF-8:...)
      const fnMatch = line.match(/^FN(?:[^:]*):(.+)/i);
      if (fnMatch && !name) name = fnMatch[1].trim() || null;

      // N:Last;First;Middle;Prefix;Suffix (fallback if no FN)
      if (!name) {
        const nMatch = line.match(/^N(?:[^:]*):(.+)/i);
        if (nMatch) {
          const parts = nMatch[1].split(';');
          const n = [parts[1], parts[0]].map(s => (s || '').trim()).filter(Boolean).join(' ');
          if (n) name = n;
        }
      }

      // TEL — includes item1.TEL format used by iCloud exports
      const telMatch = line.match(/^(?:item\d+\.)?TEL(?:[^:]*):(.+)/i);
      if (telMatch) { const raw = telMatch[1].trim(); if (raw) phones.push(raw); }
    }

    if (phones.length) contacts.push({ name: name || null, phones });
  }
  return contacts;
}

async function _waHandleOwnerCommand(phone, text) {
  const parts = text.trim().split(/\s+/);
  const cmd   = parts[0]?.toLowerCase();

  if (cmd === '!ver') {
    const { data } = await _waSupabase
      .from('whatsapp_contacts')
      .select('phone_number, contact_type, name, respond')
      .order('created_at', { ascending: false })
      .limit(20);
    const list = (data || []).map(c => `${c.phone_number} [${c.contact_type}] ${c.name || ''} respond:${c.respond}`).join('\n');
    return `Contactos guardados:\n${list || 'Ninguno'}`;
  }

  if (cmd === '!personal' && parts[1]) {
    const target = parts[1];
    await _waSupabase.from('whatsapp_contacts').upsert(
      { phone_number: target, contact_type: 'personal', respond: false, updated_at: new Date() },
      { onConflict: 'phone_number' }
    );
    return `✓ ${target} marcado como PERSONAL — no recibirá respuestas automáticas.`;
  }

  if (cmd === '!cliente' && parts[1]) {
    const target = parts[1];
    await _waSupabase.from('whatsapp_contacts').upsert(
      { phone_number: target, contact_type: 'client', respond: true, updated_at: new Date() },
      { onConflict: 'phone_number' }
    );
    return `✓ ${target} marcado como CLIENTE — recibirá respuestas automáticas.`;
  }

  return `Comandos disponibles:\n!ver — lista contactos\n!personal [número] — marcar como personal\n!cliente [número] — marcar como cliente`;
}

async function clasificarMensajeIA(texto, mensajesPrevios = []) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  const ctx = mensajesPrevios.length ? mensajesPrevios.concat(texto).join('\n') : texto;

  const respuesta = await Promise.race([
    client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 10,
      messages: [{
        role: 'user',
        content: `Eres un clasificador. Un número nuevo escribió a un negocio de Guatemala (real estate y escaneo 3D). Responde SOLO con una palabra: 'personal' si el contexto es claramente construcción/obra/albañilería/maestro de obra/arquitecto solicitando trabajo; 'client' si es real estate, escaneo 3D, tour virtual, cotización, propiedades; 'ambiguo' si es saludo simple o no se puede determinar. Mensaje(s): ${ctx}`
      }],
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
  ]);

  const raw = respuesta.content[0].text.trim().toLowerCase();
  if (raw.includes('personal')) return 'personal';
  if (raw.includes('client'))   return 'client';
  return 'ambiguo';
}

async function _waWebhookPost(req, res) {
  const sigResult = validateWASignature(req);
  if (sigResult.valid) {
    if (process.env.WHATSAPP_APP_SECRET) console.log('[WA] Signature valid ✅');
  } else {
    console.warn('[WA] Signature mismatch — enforce:', WA_SIG_ENFORCE,
      '| reason:', sigResult.reason,
      '| received:', sigResult.received,
      '| expected:', sigResult.expected);
    if (WA_SIG_ENFORCE) return res.sendStatus(403);
  }

  const _entry = req.body?.entry?.[0]?.changes?.[0]?.value;
  console.log('[WA] 1. Webhook recibido — mensajes:', _entry?.messages?.length ?? 0, '| statuses:', _entry?.statuses?.length ?? 0);

  try {
    const entry   = req.body?.entry?.[0];
    const changes = entry?.changes?.[0]?.value;
    const msg     = changes?.messages?.[0];

    // Log phone_number_id para diagnóstico de configuración
    const incomingPhoneId = changes?.metadata?.phone_number_id;
    const configuredId    = process.env.WHATSAPP_PHONE_NUMBER_ID;
    console.log('[WA] 2.7 WHATSAPP_PHONE_NUMBER_ID — incoming:', incomingPhoneId, '— configured:', configuredId, '— match:', incomingPhoneId === configuredId);

    // ── Status events (sent / delivered / read / failed) ─────────────────────
    const statuses = changes?.statuses;
    if (statuses?.length) {
      statuses.forEach(s => {
        const base = `[WA-STATUS] id:${s.id} | status:${s.status} | to:${s.recipient_id}`;
        if (s.status === 'failed') {
          console.error(base, '| errors:', JSON.stringify(s.errors));
        } else {
          console.log(base);
        }
      });
      if (!changes?.messages?.length) {
        res.sendStatus(200);
        return;
      }
    }

    if (!msg || msg.type !== 'text') {
      console.log('[WA] Sin mensaje de texto — abortando');
      res.sendStatus(200);
      return;
    }

    const phone      = msg.from;
    const text       = msg.text?.body || '';
    const message_id = msg.id;
    const isOwner    = WA_OWNER_NUMBERS.includes(phone);
    const isCommand  = text.trim().startsWith('!');

    console.log('[WA] from:', maskPhone(phone), '—', isOwner ? 'OWNER' : 'externo', '— isCommand:', isCommand, '— msgLen:', text.length);

    // ── PASO 1: Verificar inactividad ANTES de insertar ──────────────────
    const { data: lastMsgs } = await _waSupabase
      .from('whatsapp_messages')
      .select('created_at')
      .eq('phone_number', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    const lastMsg = lastMsgs?.[0];
    const horasSinActividad = lastMsg
      ? (Date.now() - new Date(lastMsg.created_at).getTime()) / 3600000
      : null;

    let esNuevoChat = !lastMsg; // primer contacto = nuevo chat

    if (lastMsg && horasSinActividad >= 3) {
      console.log('[WA] >3h inactividad (', horasSinActividad.toFixed(1), 'h) — borrando historial silenciosamente');
      await _waSupabase.from('whatsapp_messages').delete().eq('phone_number', phone);
      esNuevoChat = true;
    } else {
      console.log('[WA] Horas sin actividad:', horasSinActividad?.toFixed(1) ?? 'primer contacto');
    }

    // ── PASO 2: Guardar mensaje entrante ─────────────────────────────────
    const { error: inErr } = await _waSupabase.from('whatsapp_messages')
      .insert({ phone_number: phone, message: text, message_id, direction: 'incoming' });
    if (inErr) console.error('[WA] Supabase incoming ERROR:', inErr.message, inErr.code);
    else console.log('[WA] Supabase incoming OK ✓');

    // ── PASO 3: Upsert prospect_tracking ─────────────────────────────────
    const { data: prospect } = await _waSupabase
      .from('prospect_tracking')
      .select('id, contact_count')
      .eq('phone_number', phone)
      .single();

    if (prospect) {
      await _waSupabase.from('prospect_tracking')
        .update({ contact_count: prospect.contact_count + 1, last_contact: new Date() })
        .eq('phone_number', phone);
      console.log('[WA] prospect_tracking updated — count:', prospect.contact_count + 1);
    } else {
      await _waSupabase.from('prospect_tracking')
        .insert({ phone_number: phone, contact_count: 1, status: 'lead' });
      console.log('[WA] prospect_tracking new lead:', maskPhone(phone));
    }

    // ── Comandos owner ! (existentes) ────────────────────────────────────
    if (isOwner && isCommand) {
      const cmd = text.trim().split(/\s+/)[0]?.toLowerCase();
      console.log('[WA] from:', maskPhone(phone), '— OWNER detected — command:', cmd);
      const reply = await _waHandleOwnerCommand(phone, text);
      await _waSendMessage(phone, reply);
      console.log('[WA] Owner command response sent:', reply);
      res.sendStatus(200);
      return;
    }

    // ── Comandos owner zx/zc (clasificación de contactos) ────────────────
    // zx [numero] → personal (no responder) | zc [numero] → cliente (responder)
    if (isOwner) {
      const trimmed  = text.trim();
      const zxMatch  = trimmed.match(/^zx\s+(.*)/i);
      const zcMatch  = trimmed.match(/^zc\s+(.*)/i);
      const isZCmd   = zxMatch || zcMatch;

      if (isZCmd) {
        const rawNum    = (zxMatch || zcMatch)[1].trim();
        const targetNum = rawNum ? normalizarNumero(rawNum) : '';

        let reply;
        if (!targetNum) {
          reply = 'Uso: zx [numero] = personal | zc [numero] = cliente. Acepta cualquier formato de número.';
        } else if (zxMatch) {
          await _waSupabase.from('whatsapp_contacts').upsert(
            { phone_number: targetNum, contact_type: 'personal', respond: false, updated_at: new Date() },
            { onConflict: 'phone_number' }
          );
          reply = `✓ ${targetNum} marcado como PERSONAL (no se le responderá)`;
        } else {
          await _waSupabase.from('whatsapp_contacts').upsert(
            { phone_number: targetNum, contact_type: 'client', respond: true, updated_at: new Date() },
            { onConflict: 'phone_number' }
          );
          reply = `✓ ${targetNum} marcado como CLIENTE (se le responderá)`;
        }

        console.log('[WA] zCmd:', reply);
        await _waSendMessage(phone, reply);
        res.sendStatus(200);
        return;
      }
    }

    // ── PASO 4: Verificar contact_type ───────────────────────────────────
    const phoneNorm = normalizarNumero(phone);
    console.log('[WA] Consultando contact_type para:', maskPhone(phoneNorm), '...');
    const { data: contact, error: contactErr } = await _waSupabase
      .from('whatsapp_contacts')
      .select('contact_type, respond, name')
      .eq('phone_number', phoneNorm)
      .single();

    if (contactErr && contactErr.code !== 'PGRST116') {
      console.error('[WA] Error consultando contacto:', contactErr.message, contactErr.code);
    }

    let contactType;

    if (!contact && contactErr?.code === 'PGRST116') {
      // Número nuevo — clasificar por intención con IA
      contactType = 'client'; // FALLO SEGURO: si algo falla, responde
      try {
        // Solo incoming: el actual ya fue insertado en Paso 2, así que prevCount = count - 1
        const { count: msgCount } = await _waSupabase
          .from('whatsapp_messages')
          .select('*', { count: 'exact', head: true })
          .eq('phone_number', phone)
          .eq('direction', 'incoming');

        const prevCount = Math.max(0, (msgCount || 1) - 1);

        // Mensajes previos para contexto (excluye el actual por message_id)
        const { data: contextMsgs } = await _waSupabase
          .from('whatsapp_messages')
          .select('message')
          .eq('phone_number', phone)
          .eq('direction', 'incoming')
          .neq('message_id', message_id)
          .order('timestamp', { ascending: true })
          .limit(3);
        const contextTexts = (contextMsgs || []).map(m => m.message);

        console.log('[WA] Número nuevo — prevCount:', prevCount, '— clasificando con IA...');
        const clasificacion = await clasificarMensajeIA(text, contextTexts);
        console.log('[WA] Clasificación IA:', clasificacion, '— prevCount:', prevCount);

        if (clasificacion === 'personal') {
          contactType = 'personal';
          try {
            await _waSupabase.from('whatsapp_contacts')
              .insert({ phone_number: phoneNorm, contact_type: 'personal', respond: false });
          } catch (e) { console.error('[WA] Error insertando personal:', e.message); }
        } else if (clasificacion === 'client') {
          contactType = 'client';
          try {
            await _waSupabase.from('whatsapp_contacts')
              .insert({ phone_number: phoneNorm, contact_type: 'client', respond: true });
          } catch (e) { console.error('[WA] Error insertando client:', e.message); }
        } else {
          // ambiguo
          if (prevCount >= 2) {
            // 3er mensaje o más y sigue ambiguo → client definitivo
            contactType = 'client';
            try {
              await _waSupabase.from('whatsapp_contacts')
                .insert({ phone_number: phoneNorm, contact_type: 'client', respond: true });
            } catch (e) { console.error('[WA] Error insertando ambiguo→client:', e.message); }
            console.log('[WA] Ventana agotada (prevCount:', prevCount, ') — client definitivo');
          } else {
            // 1er o 2º mensaje ambiguo → responder sin clasificar aún
            contactType = 'client';
            console.log('[WA] Ambiguo (prevCount:', prevCount, ') — responde, re-evalúa próximo mensaje');
          }
        }
      } catch (e) {
        console.error('[WA] Clasificación IA fallida:', e.message, '— fallo seguro: client');
        // contactType ya es 'client'
      }
    } else {
      contactType = contact?.contact_type || 'null';
    }

    const esPersonal  = contactType === 'personal' || contact?.respond === false;
    console.log('[WA] contact_type:', contactType, '— Decisión:', esPersonal ? 'NO responder' : 'responder SI');

    if (esPersonal) {
      console.log('[WA] Número', maskPhone(phone), 'es personal — sin respuesta.');
    } else {
      // ── PASO 5: Si es nuevo chat → enviar bienvenida primero ─────────
      if (esNuevoChat) {
        console.log('[WA] Nuevo chat detectado — enviando bienvenida');
        const bienvenida = `¡Hola! 👋 Bienvenido/a a Virtual Estate GT. Soy tu asistente virtual y estoy aquí para ayudarte.\n\nSomos especialistas en:\n1. Real estate 🏠\n2. Escaneo 3D 📐\n3. Fotografía inmobiliaria 📸\n4. Tours virtuales 🎥\n5. Documentación técnica 📋\n6. Servicios de construcción 🔨\n\n¿Qué necesitas hoy?\n(Puedes escribir el número o tu pregunta)`;
        await _waSendMessage(phone, bienvenida);
        await _waSupabase.from('whatsapp_messages')
          .insert({ phone_number: phone, message: bienvenida, direction: 'outgoing' });
      }

      // ── Recordatorio 1h ───────────────────────────────────────────────
      if (!esNuevoChat && horasSinActividad !== null && horasSinActividad >= 1) {
        console.log('[WA] >1h inactividad — enviando recordatorio');
        await _waSendMessage(phone, '¿Aún tienes dudas? Aquí seguimos para ayudarte 😊\n\n(Nota: Este chat se reiniciará después de 3 horas de inactividad para mejor servicio)');
      }

      // ── PASO 6: Responder con Claude ──────────────────────────────────
      console.log('[WA] 3. Llamando a Claude...');
      const reply = await _waGenerateResponse(phone, text);
      console.log('[WA] 4. Respuesta de Claude:', reply);

      const { error: outErr } = await _waSupabase.from('whatsapp_messages')
        .insert({ phone_number: phone, message: reply, direction: 'outgoing' });
      if (outErr) console.error('[WA] Supabase outgoing ERROR:', outErr.message);
      else console.log('[WA] Supabase outgoing OK ✓');

      console.log('[WA] 5. Enviando a WhatsApp...');
      await _waSendMessage(phone, reply);
      console.log('[WA] 6. Éxito — mensaje enviado a', maskPhone(phone));
    }
  } catch (error) {
    console.error('[WA] ERROR:', error.message);
    console.error('[WA] STACK:', error.stack);
  }

  res.sendStatus(200);
}

// Exportar el app para Vercel (api/index.js lo importa)
module.exports = app;

// app.listen solo cuando se corre directamente (desarrollo local)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
  });
}
