require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const authMiddleware = require('./src/middleware/auth');

app.use(cors());

// Capture raw body for WhatsApp webhook signature validation BEFORE json parser
app.use((req, res, next) => {
  if (req.path === '/api/webhook/whatsapp') {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => { req.rawBody = data; next(); });
  } else {
    next();
  }
});

// 2mb limit to support PDF HTML payloads (~600KB machote) sent from the admin frontend
app.use(express.json({ limit: '2mb' }));

// Auth (pública — sin protección)
const authRouter = require('./src/routes/auth');
app.use('/api/auth', authRouter);

// Public endpoints — no auth
const supabasePublic = require('./src/config/supabase');

app.get('/api/propiedades/public', async (req, res) => {
  try {
    const { zona, tipo, modalidad, precio_min, precio_max, m2_min, m2_max } = req.query;
    const applyFilters = (q) => {
      if (zona)       q = q.ilike('zona', `%${zona}%`);
      if (tipo)       q = q.eq('tipo', tipo);
      if (modalidad)  q = q.eq('modalidad', modalidad);
      if (precio_min) q = q.gte('precio', Number(precio_min));
      if (precio_max) q = q.lte('precio', Number(precio_max));
      if (m2_min)     q = q.gte('m2', Number(m2_min));
      if (m2_max)     q = q.lte('m2', Number(m2_max));
      return q;
    };
    // Try with adicionales join first; fall back to base select if table doesn't exist yet
    let { data, error } = await applyFilters(
      supabasePublic.from('propiedades')
        .select('id,nombre,tipo,modalidad,precio,m2,zona,linktour3d,propiedades_adicionales(tipo,nombre)')
        .order('id', { ascending: false })
    );
    if (error && error.message && error.message.includes('propiedades_adicionales')) {
      ({ data, error } = await applyFilters(
        supabasePublic.from('propiedades')
          .select('id,nombre,tipo,modalidad,precio,m2,zona,linktour3d')
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
  try {
    const { nombre, email, telefono, empresa, mensaje } = req.body;
    if (!nombre || !email) return res.status(400).json({ error: 'Nombre y correo son requeridos' });
    const { data, error } = await supabasePublic
      .from('leads')
      .insert([{ nombre, email, telefono, empresa: empresa || mensaje || '', estado: 'Nuevo' }])
      .select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Public: WhatsApp webhook (no auth — validated via signature) ──
const webhookWARouter = require('./src/routes/webhook-whatsapp');
app.use('/api/webhook/whatsapp', webhookWARouter);

// ── Public: Cotización confirmation portal (no auth — leads access via email link) ──
const confirmacionRouter = require('./src/routes/confirmacion');
app.use('/api/confirmacion', confirmacionRouter);
app.use('/api/cron', confirmacionRouter);

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
const imageGallery           = require('./src/routes/image-gallery');

const { requireMinRole, requirePortalOrStaff, requireSuperadmin } = require('./src/middleware/roles');

app.use('/api/leads',         authMiddleware, requireMinRole('asistente'), leadsRouter);
app.use('/api/clientes',      authMiddleware, requirePortalOrStaff('asistente'), clientesRouter);
app.use('/api/propiedades',   authMiddleware, requireMinRole('asistente'), propiedadesRouter);
app.use('/api/proyectos',     authMiddleware, requireMinRole('asistente'), proyectosRouter);
app.use('/api/cotizaciones',  authMiddleware, requireMinRole('asistente'), cotizacionesRouter);
app.use('/api/marketing',    authMiddleware, requireMinRole('gerente'),   marketingAgent);
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

// ── Envío de cotizaciones por canal ──────────────────────────────────────────
// RAW INTERCEPTOR — fires before auth, confirms the request reaches this server
app.use(['/api/whatsapp/enviar-cotizacion', '/api/email/enviar-cotizacion'], (req, res, next) => {
  console.log('[ENVIO-INTERCEPT] ▶ method:', req.method, '| path:', req.path, '| body keys:', Object.keys(req.body || {}));
  next();
});
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

// Debug: filesystem info
app.get('/api/debug', (req, res) => {
  const fs = require('fs');
  res.json({
    __dirname,
    vercel: !!process.env.VERCEL,
    adminHtml: fs.existsSync(path.join(__dirname, 'admin.html')),
    files: (() => { try { return fs.readdirSync(__dirname); } catch (e) { return e.message; } })()
  });
});


// Páginas HTML — rutas explícitas con sendFile para funcionar en Vercel Lambda
// (express.static con directory scan no es confiable en entornos serverless)
const html = (file) => (req, res) => res.sendFile(path.join(__dirname, file));
app.get('/',                html('index.html'));
app.get('/index.html',      html('index.html'));
app.get('/admin.html',                 html('admin.html'));
app.get('/test-debug', (req, res) => {
  res.json({ message: 'Server is working', __dirname: __dirname });
});
app.get('/marketing-agent-panel.html', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send("<!DOCTYPE html>\n<html lang=\"es\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <title>Agente IA Marketing — Virtual Estate</title>\n  <style>\n    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\n    :root {\n      --bg: #0f1117; --surface: #1a1d27; --card: #22263a; --border: #2e3347;\n      --primary: #4f8a3a; --gold: #b8860b; --text: #e2e8f0; --muted: #8892a4;\n      --danger: #e53e3e; --success: #38a169; --warning: #d69e2e; --info: #3182ce;\n      --radius: 10px;\n    }\n    body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }\n    .header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 24px; display: flex; align-items: center; justify-content: space-between; height: 60px; }\n    .header-brand { display: flex; align-items: center; gap: 12px; }\n    .header-brand img { height: 32px; }\n    .header-brand h1 { font-size: 16px; font-weight: 600; }\n    .header-brand span { font-size: 12px; color: var(--primary); font-weight: 600; background: rgba(79,138,58,.15); padding: 2px 8px; border-radius: 20px; }\n    .header-actions { display: flex; gap: 10px; }\n    .layout { display: flex; height: calc(100vh - 60px); }\n    .sidebar { width: 200px; background: var(--surface); border-right: 1px solid var(--border); padding: 16px 0; flex-shrink: 0; }\n    .nav-item { padding: 10px 20px; cursor: pointer; font-size: 13px; color: var(--muted); display: flex; align-items: center; gap: 10px; transition: all .15s; border-left: 3px solid transparent; }\n    .nav-item:hover { color: var(--text); background: rgba(255,255,255,.04); }\n    .nav-item.active { color: var(--text); background: rgba(79,138,58,.12); border-left-color: var(--primary); }\n    .nav-section { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; padding: 12px 20px 4px; }\n    .main { flex: 1; overflow-y: auto; padding: 24px; }\n    .section { display: none; }\n    .section.active { display: block; }\n    .card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; margin-bottom: 16px; }\n    .card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }\n    .card-title { font-size: 14px; font-weight: 600; }\n    .card-subtitle { font-size: 12px; color: var(--muted); margin-top: 2px; }\n    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }\n    .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }\n    label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 5px; }\n    input, textarea, select { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 9px 12px; color: var(--text); font-size: 13px; transition: border-color .15s; }\n    input:focus, textarea:focus, select:focus { outline: none; border-color: var(--primary); }\n    textarea { resize: vertical; min-height: 80px; }\n    .form-group { margin-bottom: 14px; }\n    .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border: none; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; transition: all .15s; }\n    .btn-primary { background: var(--primary); color: #fff; }\n    .btn-primary:hover { background: #3d6e2c; }\n    .btn-gold { background: var(--gold); color: #fff; }\n    .btn-gold:hover { background: #9a7009; }\n    .btn-ghost { background: transparent; color: var(--muted); border: 1px solid var(--border); }\n    .btn-ghost:hover { color: var(--text); border-color: var(--muted); }\n    .btn-danger { background: var(--danger); color: #fff; }\n    .btn-success { background: var(--success); color: #fff; }\n    .btn-sm { padding: 5px 10px; font-size: 12px; }\n    .btn:disabled { opacity: .5; cursor: not-allowed; }\n    .stats-row { display: grid; grid-template-columns: repeat(4,1fr); gap: 14px; margin-bottom: 20px; }\n    .stat-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; text-align: center; }\n    .stat-num { font-size: 28px; font-weight: 700; color: var(--primary); }\n    .stat-label { font-size: 12px; color: var(--muted); margin-top: 4px; }\n    .posts-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px,1fr)); gap: 16px; }\n    .post-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; transition: border-color .15s; }\n    .post-card:hover { border-color: var(--primary); }\n    .post-image { height: 160px; background: linear-gradient(135deg,#1a2e14,#2d5016); display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; }\n    .post-image img { width: 100%; height: 100%; object-fit: cover; }\n    .post-body { padding: 14px; }\n    .post-theme { font-size: 11px; color: var(--primary); font-weight: 600; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }\n    .post-caption { font-size: 12px; color: var(--text); line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }\n    .post-hashtags { font-size: 11px; color: var(--info); margin-top: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }\n    .post-actions { display: flex; gap: 6px; padding: 10px 14px; border-top: 1px solid var(--border); flex-wrap: wrap; }\n    .post-date { font-size: 11px; color: var(--muted); padding: 0 14px 10px; }\n    .badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; position: absolute; top: 8px; right: 8px; }\n    .badge-pending  { background: rgba(214,158,46,.15); color: var(--warning); }\n    .badge-approved { background: rgba(56,161,105,.15); color: var(--success); }\n    .badge-rejected { background: rgba(229,62,62,.15);  color: var(--danger); }\n    .badge-published{ background: rgba(49,130,206,.15); color: var(--info); }\n    .generate-area { background: linear-gradient(135deg,rgba(79,138,58,.12),rgba(184,134,11,.08)); border: 1px dashed var(--primary); border-radius: var(--radius); padding: 32px; text-align: center; margin-bottom: 20px; }\n    .generate-area h3 { font-size: 18px; margin-bottom: 6px; }\n    .generate-area p  { font-size: 13px; color: var(--muted); margin-bottom: 20px; }\n    .order-item { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 8px; }\n    .history-item { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; margin-bottom: 8px; display: flex; gap: 14px; align-items: center; }\n    .history-thumb { width: 56px; height: 56px; border-radius: 6px; background: linear-gradient(135deg,#1a2e14,#2d5016); flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 20px; overflow: hidden; }\n    .history-info { flex: 1; min-width: 0; }\n    .history-theme { font-size: 11px; color: var(--primary); font-weight: 600; }\n    .history-caption { font-size: 12px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }\n    .history-date { font-size: 11px; color: var(--muted); margin-top: 3px; }\n    #toast { position: fixed; bottom: 24px; right: 24px; background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px 18px; font-size: 13px; z-index: 9999; transform: translateY(80px); opacity: 0; transition: all .25s; pointer-events: none; max-width: 320px; box-shadow: 0 8px 24px rgba(0,0,0,.4); }\n    #toast.show { transform: translateY(0); opacity: 1; }\n    .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.7); z-index: 8000; align-items: center; justify-content: center; }\n    .modal-overlay.open { display: flex; }\n    .modal { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px; width: 90%; max-width: 560px; max-height: 85vh; overflow-y: auto; }\n    .modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }\n    .modal-title { font-size: 16px; font-weight: 600; }\n    .spinner { width: 18px; height: 18px; border: 2px solid rgba(255,255,255,.2); border-top-color: #fff; border-radius: 50%; animation: spin .6s linear infinite; display: none; }\n    @keyframes spin { to { transform: rotate(360deg); } }\n    .empty-state { text-align: center; padding: 48px 24px; color: var(--muted); }\n    .empty-state span { font-size: 40px; display: block; margin-bottom: 12px; }\n    .empty-state p { font-size: 13px; }\n    .color-row { display: flex; align-items: center; gap: 10px; }\n  </style>\n</head>\n<body>\n\n<header class=\"header\">\n  <div class=\"header-brand\">\n    <img src=\"/images/assets/logo-isotipo.png\" alt=\"VE\" onerror=\"this.style.display='none'\">\n    <h1>Agente IA Marketing</h1>\n    <span>BETA</span>\n  </div>\n  <div class=\"header-actions\">\n    <button class=\"btn btn-ghost btn-sm\" onclick=\"window.location='/admin.html'\">← CRM</button>\n    <button class=\"btn btn-gold btn-sm\" onclick=\"generateContent()\">✨ Generar contenido</button>\n  </div>\n</header>\n\n<div class=\"layout\">\n  <nav class=\"sidebar\">\n    <div class=\"nav-section\">Panel</div>\n    <div class=\"nav-item active\" onclick=\"showSection('dashboard',this)\">📊 Dashboard</div>\n    <div class=\"nav-section\">Configuración</div>\n    <div class=\"nav-item\" onclick=\"showSection('brand',this)\">🎨 Identidad de Marca</div>\n    <div class=\"nav-item\" onclick=\"showSection('instructions',this)\">📋 Instrucciones</div>\n    <div class=\"nav-item\" onclick=\"showSection('orders',this)\">📌 Órdenes de Contenido</div>\n    <div class=\"nav-section\">Contenido</div>\n    <div class=\"nav-item\" onclick=\"showSection('pending',this)\">⏳ Posts Pendientes</div>\n    <div class=\"nav-item\" onclick=\"showSection('history',this)\">✅ Publicados</div>\n    <div class=\"nav-item\" onclick=\"showSection('gallery',this)\">📸 Galería de Imágenes</div>\n  </nav>\n\n  <main class=\"main\">\n\n    <!-- DASHBOARD -->\n    <section id=\"sec-dashboard\" class=\"section active\">\n      <div class=\"stats-row\">\n        <div class=\"stat-card\"><div class=\"stat-num\" id=\"stat-pending\">—</div><div class=\"stat-label\">Pendientes</div></div>\n        <div class=\"stat-card\"><div class=\"stat-num\" id=\"stat-approved\">—</div><div class=\"stat-label\">Aprobados</div></div>\n        <div class=\"stat-card\"><div class=\"stat-num\" id=\"stat-published\">—</div><div class=\"stat-label\">Publicados</div></div>\n        <div class=\"stat-card\"><div class=\"stat-num\" id=\"stat-orders\">—</div><div class=\"stat-label\">Órdenes activas</div></div>\n      </div>\n      <div class=\"generate-area\">\n        <h3>✨ Generar contenido con IA</h3>\n        <p>El agente analizará tu marca, instrucciones y órdenes activas para crear 5 posts listos para aprobar.</p>\n        <button class=\"btn btn-gold\" id=\"btn-generate\" onclick=\"generateContent()\">\n          <span class=\"spinner\" id=\"gen-spinner\"></span>\n          Generar 5 posts ahora\n        </button>\n      </div>\n      <div class=\"card\">\n        <div class=\"card-header\">\n          <div><div class=\"card-title\">Posts recientes para revisar</div><div class=\"card-subtitle\">Últimos generados pendientes de aprobación</div></div>\n          <button class=\"btn btn-ghost btn-sm\" onclick=\"showSection('pending',document.querySelectorAll('.nav-item')[4])\">Ver todos</button>\n        </div>\n        <div id=\"dashboard-pending-list\"></div>\n      </div>\n    </section>\n\n    <!-- BRAND -->\n    <section id=\"sec-brand\" class=\"section\">\n      <div class=\"card\">\n        <div class=\"card-header\">\n          <div><div class=\"card-title\">🎨 Identidad de Marca</div><div class=\"card-subtitle\">Colores y lineamientos visuales</div></div>\n          <button class=\"btn btn-primary btn-sm\" onclick=\"saveBrand()\">Guardar cambios</button>\n        </div>\n        <div class=\"grid-2\">\n          <div class=\"form-group\"><label>URL del Logo</label><input type=\"url\" id=\"b-logo\" placeholder=\"https://...\" oninput=\"updateLogoPreview()\"></div>\n          <div class=\"form-group\"><label>Vista previa</label>\n            <div style=\"height:42px;display:flex;align-items:center\">\n              <img id=\"b-logo-preview\" src=\"\" style=\"max-height:40px;max-width:180px;display:none;border-radius:4px\">\n              <span id=\"b-logo-empty\" style=\"font-size:12px;color:var(--muted)\">Ingresa una URL</span>\n            </div>\n          </div>\n        </div>\n        <div class=\"grid-3\">\n          <div class=\"form-group\"><label>Color Primario</label>\n            <div class=\"color-row\">\n              <input type=\"color\" id=\"b-color1\" value=\"#2D5016\" style=\"width:42px;height:42px;padding:2px;cursor:pointer;flex-shrink:0\" oninput=\"document.getElementById('b-color1-hex').value=this.value\">\n              <input type=\"text\"  id=\"b-color1-hex\" value=\"#2D5016\" style=\"flex:1\" oninput=\"if(/^#[0-9a-fA-F]{6}$/.test(this.value))document.getElementById('b-color1').value=this.value\">\n            </div>\n          </div>\n          <div class=\"form-group\"><label>Color Secundario</label>\n            <div class=\"color-row\">\n              <input type=\"color\" id=\"b-color2\" value=\"#B8860B\" style=\"width:42px;height:42px;padding:2px;cursor:pointer;flex-shrink:0\" oninput=\"document.getElementById('b-color2-hex').value=this.value\">\n              <input type=\"text\"  id=\"b-color2-hex\" value=\"#B8860B\" style=\"flex:1\" oninput=\"if(/^#[0-9a-fA-F]{6}$/.test(this.value))document.getElementById('b-color2').value=this.value\">\n            </div>\n          </div>\n          <div class=\"form-group\"><label>Color de Acento</label>\n            <div class=\"color-row\">\n              <input type=\"color\" id=\"b-color3\" value=\"#FFFFFF\" style=\"width:42px;height:42px;padding:2px;cursor:pointer;flex-shrink:0\" oninput=\"document.getElementById('b-color3-hex').value=this.value\">\n              <input type=\"text\"  id=\"b-color3-hex\" value=\"#FFFFFF\" style=\"flex:1\" oninput=\"if(/^#[0-9a-fA-F]{6}$/.test(this.value))document.getElementById('b-color3').value=this.value\">\n            </div>\n          </div>\n        </div>\n        <div class=\"form-group\"><label>Lineamientos de Marca</label><textarea id=\"b-guidelines\" rows=\"5\" placeholder=\"Tono, personalidad, qué evitar, estilo visual...\"></textarea></div>\n      </div>\n    </section>\n\n    <!-- INSTRUCTIONS -->\n    <section id=\"sec-instructions\" class=\"section\">\n      <div class=\"card\">\n        <div class=\"card-header\">\n          <div><div class=\"card-title\">📋 Instrucciones Globales del Agente</div><div class=\"card-subtitle\">Usadas en cada generación de contenido</div></div>\n          <button class=\"btn btn-primary btn-sm\" onclick=\"saveInstructions()\">Guardar cambios</button>\n        </div>\n        <div class=\"grid-2\">\n          <div class=\"form-group\"><label>Tono de comunicación</label>\n            <select id=\"i-tone\">\n              <option value=\"profesional\">Profesional</option>\n              <option value=\"profesional y cercano\" selected>Profesional y cercano</option>\n              <option value=\"elegante\">Elegante y sofisticado</option>\n              <option value=\"inspiracional\">Inspiracional</option>\n              <option value=\"informativo\">Informativo y educativo</option>\n            </select>\n          </div>\n          <div class=\"form-group\"><label>Posts mínimos por semana</label><input type=\"number\" id=\"i-frequency\" value=\"5\" min=\"1\" max=\"21\"></div>\n        </div>\n        <div class=\"form-group\"><label>Hashtags predeterminados (uno por línea)</label><textarea id=\"i-hashtags\" rows=\"5\" placeholder=\"#VirtualEstateGT&#10;#InmobiliariaGuatemala\"></textarea></div>\n        <div class=\"form-group\"><label>Llamada a la acción (CTA)</label><input type=\"text\" id=\"i-cta\" placeholder=\"Escríbenos por WhatsApp para más información\"></div>\n        <div class=\"form-group\"><label>Horarios preferidos (HH:MM, uno por línea)</label><textarea id=\"i-times\" rows=\"3\" placeholder=\"09:00&#10;13:00&#10;18:00\"></textarea></div>\n        <div class=\"form-group\"><label>Temas a EVITAR</label><input type=\"text\" id=\"i-avoid\" placeholder=\"política, precios exactos, competidores\"></div>\n        <div class=\"form-group\"><label>Instrucciones adicionales</label><textarea id=\"i-extra\" rows=\"4\" placeholder=\"Cualquier instrucción adicional permanente...\"></textarea></div>\n      </div>\n    </section>\n\n    <!-- ORDERS -->\n    <section id=\"sec-orders\" class=\"section\">\n      <div class=\"card\">\n        <div class=\"card-header\"><div class=\"card-title\">📌 Nueva Orden de Contenido</div></div>\n        <div class=\"grid-2\">\n          <div class=\"form-group\"><label>Instrucción principal *</label><textarea id=\"o-instruction\" rows=\"3\" placeholder=\"Ej: Posts destacando el servicio de escaneo 3D para construcción\"></textarea></div>\n          <div class=\"form-group\"><label>Tema / Campaña</label><input type=\"text\" id=\"o-theme\" placeholder=\"Ej: Campaña Construcción Q2\"></div>\n        </div>\n        <div class=\"grid-3\">\n          <div class=\"form-group\"><label>Prioridad (1-5)</label><input type=\"number\" id=\"o-priority\" value=\"1\" min=\"1\" max=\"5\"></div>\n          <div class=\"form-group\"><label>Fecha inicio</label><input type=\"date\" id=\"o-start\"></div>\n          <div class=\"form-group\"><label>Fecha fin</label><input type=\"date\" id=\"o-end\"></div>\n        </div>\n        <button class=\"btn btn-primary\" onclick=\"addOrder()\">+ Agregar orden</button>\n      </div>\n      <div class=\"card\">\n        <div class=\"card-header\"><div class=\"card-title\">Órdenes activas</div></div>\n        <div id=\"orders-list\"><div class=\"empty-state\"><span>📌</span><p>No hay órdenes activas</p></div></div>\n      </div>\n    </section>\n\n    <!-- PENDING POSTS -->\n    <section id=\"sec-pending\" class=\"section\">\n      <div class=\"card-header\" style=\"margin-bottom:16px\">\n        <div><div class=\"card-title\" style=\"font-size:16px\">⏳ Posts Pendientes</div><div class=\"card-subtitle\" style=\"margin-top:4px\">Aprueba, edita o rechaza posts generados por IA</div></div>\n        <button class=\"btn btn-ghost btn-sm\" onclick=\"loadPendingPosts()\">↻ Actualizar</button>\n      </div>\n      <div class=\"posts-grid\" id=\"pending-grid\"><div class=\"empty-state\" style=\"grid-column:1/-1\"><span>⏳</span><p>Cargando...</p></div></div>\n    </section>\n\n    <!-- HISTORY -->\n    <section id=\"sec-history\" class=\"section\">\n      <div class=\"card-header\" style=\"margin-bottom:16px\">\n        <div><div class=\"card-title\" style=\"font-size:16px\">✅ Posts Publicados</div><div class=\"card-subtitle\" style=\"margin-top:4px\">Historial de contenido publicado en Instagram</div></div>\n        <button class=\"btn btn-ghost btn-sm\" onclick=\"loadHistory()\">↻ Actualizar</button>\n      </div>\n      <div id=\"history-list\"><div class=\"empty-state\"><span>✅</span><p>Cargando...</p></div></div>\n    </section>\n\n    <!-- GALERÍA DE IMÁGENES -->\n    <section id=\"sec-gallery\" class=\"section\">\n      <div class=\"card\">\n        <div class=\"card-header\">\n          <div><div class=\"card-title\">📷 Imágenes de Marca</div><div class=\"card-subtitle\">Fotos propias para usar en posts</div></div>\n          <button class=\"btn btn-ghost btn-sm\" onclick=\"loadGallery()\">↻ Actualizar</button>\n        </div>\n        <div class=\"grid-2\" style=\"margin-bottom:14px\">\n          <div class=\"form-group\"><label>Archivo de imagen</label><input type=\"file\" id=\"g-brand-file\" accept=\"image/*\"></div>\n          <div class=\"form-group\"><label>Descripción</label><input type=\"text\" id=\"g-brand-desc\" placeholder=\"Ej: Fachada principal\"></div>\n        </div>\n        <div class=\"form-group\" style=\"max-width:220px\"><label>Categoría</label>\n          <select id=\"g-brand-cat\">\n            <option value=\"general\">General</option>\n            <option value=\"fachada\">Fachada</option>\n            <option value=\"interior\">Interior</option>\n            <option value=\"detalle\">Detalle</option>\n          </select>\n        </div>\n        <button class=\"btn btn-primary btn-sm\" onclick=\"addBrandImage()\">+ Subir imagen</button>\n        <div id=\"brand-images-grid\" style=\"display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:18px\"></div>\n      </div>\n\n      <div class=\"card\">\n        <div class=\"card-header\">\n          <div><div class=\"card-title\">🎨 Referencias Visuales</div><div class=\"card-subtitle\">Inspiración para el agente IA</div></div>\n        </div>\n        <div class=\"grid-2\" style=\"margin-bottom:14px\">\n          <div class=\"form-group\"><label>Archivo de referencia</label><input type=\"file\" id=\"g-ref-file\" accept=\"image/*\"></div>\n          <div class=\"form-group\"><label>Qué es esta imagen</label><input type=\"text\" id=\"g-ref-desc\" placeholder=\"Ej: Foto de propiedad con buena iluminación\"></div>\n        </div>\n        <div class=\"form-group\"><label>Qué quiero copiar / inspirarme</label><textarea id=\"g-ref-copy\" rows=\"2\" placeholder=\"Ej: El ángulo, los colores cálidos, el estilo minimalista\"></textarea></div>\n        <button class=\"btn btn-primary btn-sm\" onclick=\"addReference()\">+ Subir referencia</button>\n        <div id=\"references-grid\" style=\"display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:18px\"></div>\n      </div>\n    </section>\n\n  </main>\n</div>\n\n<div id=\"toast\"></div>\n\n<div class=\"modal-overlay\" id=\"post-modal\">\n  <div class=\"modal\">\n    <div class=\"modal-header\">\n      <div class=\"modal-title\" id=\"modal-theme\">Detalle del post</div>\n      <button class=\"btn btn-ghost btn-sm\" onclick=\"closePostModal()\">✕</button>\n    </div>\n    <div id=\"modal-body\"></div>\n    <div style=\"margin-top:16px;display:flex;gap:8px;justify-content:flex-end\" id=\"modal-actions\"></div>\n  </div>\n</div>\n\n<div class=\"modal-overlay\" id=\"publish-modal\">\n  <div class=\"modal\" style=\"max-width:700px\">\n    <div class=\"modal-header\">\n      <div class=\"modal-title\">📤 Publicar Post</div>\n      <button class=\"btn btn-ghost btn-sm\" onclick=\"closePublishModal()\">✕</button>\n    </div>\n    <label style=\"margin-bottom:8px;display:block\">Selecciona una imagen de tu galería:</label>\n    <div id=\"publish-img-grid\" style=\"display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-bottom:14px;max-height:260px;overflow-y:auto\"></div>\n    <div id=\"publish-img-preview\" style=\"border-radius:6px;overflow:hidden;margin-bottom:14px;background:var(--surface);padding:10px\">\n      <p style=\"color:var(--muted);margin:0;font-size:12px\">Vista previa de imagen seleccionada</p>\n    </div>\n    <div style=\"background:var(--surface);padding:12px;border-radius:6px;margin-bottom:14px\">\n      <div style=\"font-size:11px;color:var(--muted);margin-bottom:4px\">Prompt para generar imagen (DALL-E / Midjourney):</div>\n      <div id=\"publish-img-prompt\" style=\"font-size:13px;color:var(--text);line-height:1.5\"></div>\n      <button class=\"btn btn-ghost btn-sm\" style=\"margin-top:8px\" onclick=\"copyImagePrompt()\">Copiar prompt</button>\n    </div>\n    <div style=\"display:flex;gap:8px;justify-content:flex-end\">\n      <button class=\"btn btn-ghost\" onclick=\"closePublishModal()\">Cancelar</button>\n      <button class=\"btn btn-gold\" onclick=\"confirmPublish()\">Publicar ahora</button>\n    </div>\n  </div>\n</div>\n\n<script>\nconst API_BASE = '/api/marketing';\nconst getAuthToken = () => localStorage.getItem('ve_token') || localStorage.getItem('authToken') || '';\n\nconst getApiKey = () => {\n  const stored = localStorage.getItem('anthropic_api_key');\n  if (!stored) {\n    const key = prompt('Ingresa tu API key de Anthropic (sk-ant-...):');\n    if (key) localStorage.setItem('anthropic_api_key', key);\n    return key;\n  }\n  return stored;\n};\n\nconst fetchWithAuth = (url, options = {}) => fetch(url, {\n  ...options,\n  headers: {\n    'Content-Type': 'application/json',\n    'Authorization': `Bearer ${getAuthToken()}`,\n    ...(options.headers || {})\n  }\n});\n\nasync function api(method, path, body) {\n  const res = await fetchWithAuth(API_BASE + path, {\n    method,\n    body: body ? JSON.stringify(body) : undefined\n  });\n  const data = await res.json();\n  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);\n  return data;\n}\n\nfunction showSection(name, el) {\n  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));\n  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));\n  document.getElementById('sec-' + name)?.classList.add('active');\n  if (el) el.classList.add('active');\n  ({ dashboard: loadDashboard, brand: loadBrand, instructions: loadInstructions, orders: loadOrders, pending: loadPendingPosts, history: loadHistory, gallery: loadGallery })[name]?.();\n}\n\nfunction toast(msg, type = 'default') {\n  const t = document.getElementById('toast');\n  t.style.color = ({ success: '#38a169', danger: '#e53e3e' })[type] || '#e2e8f0';\n  t.textContent = msg;\n  t.classList.add('show');\n  setTimeout(() => t.classList.remove('show'), 3500);\n}\n\n// ── DASHBOARD ──\nasync function loadDashboard() {\n  try {\n    const [pending, published, orders] = await Promise.all([api('GET','/posts/pending'), api('GET','/posts/published'), api('GET','/orders')]);\n    document.getElementById('stat-pending').textContent   = pending.filter(p => p.status==='pending').length;\n    document.getElementById('stat-approved').textContent  = pending.filter(p => p.status==='approved').length;\n    document.getElementById('stat-published').textContent = published.length;\n    document.getElementById('stat-orders').textContent    = orders.length;\n    const recent = pending.filter(p => p.status==='pending').slice(0,3);\n    const cont = document.getElementById('dashboard-pending-list');\n    cont.innerHTML = recent.length ? recent.map(p => `\n      <div style=\"display:flex;gap:12px;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:8px;align-items:center\">\n        <div style=\"width:48px;height:48px;border-radius:6px;background:linear-gradient(135deg,#1a2e14,#2d5016);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:20px\">📸</div>\n        <div style=\"flex:1;min-width:0\">\n          <div style=\"font-size:11px;color:var(--primary);font-weight:600\">${p.theme||'Sin tema'}</div>\n          <div style=\"font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis\">${p.instagram_caption||p.content||''}</div>\n        </div>\n        <div style=\"display:flex;gap:6px;flex-shrink:0\">\n          <button class=\"btn btn-success btn-sm\" onclick=\"approvePost(${p.id})\">✓</button>\n          <button class=\"btn btn-ghost btn-sm\" onclick=\"openPostModal(${p.id})\">Ver</button>\n        </div>\n      </div>`).join('') : '<div class=\"empty-state\"><span>✨</span><p>No hay posts pendientes.</p></div>';\n  } catch (e) { toast('Error: '+e.message,'danger'); }\n}\n\n// ── BRAND ──\nasync function loadBrand() {\n  try {\n    const b = await api('GET','/brand-identity');\n    document.getElementById('b-logo').value       = b.logo_url||'';\n    document.getElementById('b-color1').value     = b.color_primary||'#2D5016';\n    document.getElementById('b-color1-hex').value = b.color_primary||'#2D5016';\n    document.getElementById('b-color2').value     = b.color_secondary||'#B8860B';\n    document.getElementById('b-color2-hex').value = b.color_secondary||'#B8860B';\n    document.getElementById('b-color3').value     = b.color_accent||'#FFFFFF';\n    document.getElementById('b-color3-hex').value = b.color_accent||'#FFFFFF';\n    document.getElementById('b-guidelines').value = b.brand_guidelines||'';\n    updateLogoPreview();\n  } catch(e) { toast('Error: '+e.message,'danger'); }\n}\nasync function saveBrand() {\n  try {\n    await api('POST','/brand-identity',{ logo_url: document.getElementById('b-logo').value, color_primary: document.getElementById('b-color1-hex').value, color_secondary: document.getElementById('b-color2-hex').value, color_accent: document.getElementById('b-color3-hex').value, brand_guidelines: document.getElementById('b-guidelines').value });\n    toast('Identidad de marca guardada ✓','success');\n  } catch(e) { toast('Error: '+e.message,'danger'); }\n}\nfunction updateLogoPreview() {\n  const url=document.getElementById('b-logo').value, img=document.getElementById('b-logo-preview'), empty=document.getElementById('b-logo-empty');\n  if(url){img.src=url;img.style.display='block';empty.style.display='none';}else{img.style.display='none';empty.style.display='block';}\n}\n\n// ── INSTRUCTIONS ──\nasync function loadInstructions() {\n  try {\n    const d = await api('GET','/instructions');\n    document.getElementById('i-tone').value      = d.tone||'profesional y cercano';\n    document.getElementById('i-frequency').value = d.min_posts_per_week||5;\n    document.getElementById('i-cta').value       = d.required_cta||'';\n    document.getElementById('i-avoid').value     = d.avoid_topics||'';\n    document.getElementById('i-extra').value     = d.extra_instructions||'';\n    document.getElementById('i-hashtags').value  = (d.hashtags||[]).join('\\n');\n    document.getElementById('i-times').value     = (d.publish_times||['09:00','13:00','18:00']).join('\\n');\n  } catch(e) { toast('Error: '+e.message,'danger'); }\n}\nasync function saveInstructions() {\n  try {\n    await api('POST','/instructions',{ tone: document.getElementById('i-tone').value, min_posts_per_week: Number(document.getElementById('i-frequency').value), required_cta: document.getElementById('i-cta').value, avoid_topics: document.getElementById('i-avoid').value, extra_instructions: document.getElementById('i-extra').value, hashtags: document.getElementById('i-hashtags').value.split('\\n').map(h=>h.trim()).filter(Boolean), publish_times: document.getElementById('i-times').value.split('\\n').map(t=>t.trim()).filter(Boolean) });\n    toast('Instrucciones guardadas ✓','success');\n  } catch(e) { toast('Error: '+e.message,'danger'); }\n}\n\n// ── ORDERS ──\nasync function loadOrders() {\n  try {\n    const orders = await api('GET','/orders');\n    document.getElementById('stat-orders').textContent = orders.length;\n    document.getElementById('orders-list').innerHTML = orders.length ? orders.map(o=>`\n      <div class=\"order-item\">\n        <div style=\"flex:1\">\n          <div style=\"font-size:11px;color:var(--gold);font-weight:600\">⭐ Prioridad ${o.priority}${o.focus_theme?' · '+o.focus_theme:''}</div>\n          <div style=\"font-size:13px;color:var(--text);margin-top:2px\">${o.instruction}</div>\n          ${o.start_date?`<div style=\"font-size:11px;color:var(--muted);margin-top:2px\">${o.start_date}${o.end_date?' → '+o.end_date:''}</div>`:''}\n        </div>\n        <button class=\"btn btn-ghost btn-sm\" onclick=\"removeOrder(${o.id})\" title=\"Completar\">✕</button>\n      </div>`).join('') : '<div class=\"empty-state\"><span>📌</span><p>No hay órdenes activas</p></div>';\n  } catch(e) { toast('Error: '+e.message,'danger'); }\n}\nasync function addOrder() {\n  const instruction=document.getElementById('o-instruction').value.trim();\n  if(!instruction){toast('Escribe una instrucción primero','danger');return;}\n  try {\n    await api('POST','/orders',{ instruction, focus_theme: document.getElementById('o-theme').value, priority: Number(document.getElementById('o-priority').value)||1, start_date: document.getElementById('o-start').value||null, end_date: document.getElementById('o-end').value||null });\n    ['o-instruction','o-theme','o-start','o-end'].forEach(id=>document.getElementById(id).value='');\n    toast('Orden agregada ✓','success'); loadOrders();\n  } catch(e) { toast('Error: '+e.message,'danger'); }\n}\nasync function removeOrder(id) {\n  try { await api('DELETE','/orders/'+id); toast('Orden completada ✓','success'); loadOrders(); }\n  catch(e) { toast('Error: '+e.message,'danger'); }\n}\n\n// ── GENERATE ──\nasync function generateContent() {\n  const apiKey = getApiKey();\n  if (!apiKey) { alert('API key de Anthropic requerida'); return; }\n  const btn=document.getElementById('btn-generate'), sp=document.getElementById('gen-spinner');\n  btn.disabled=true; sp.style.display='block'; btn.lastChild.textContent=' Generando con IA...';\n  try {\n    const res = await fetch(API_BASE + '/generate', {\n      method: 'POST',\n      headers: {\n        'Content-Type': 'application/json',\n        'Authorization': `Bearer ${getAuthToken()}`,\n        'X-API-Key': apiKey\n      }\n    });\n    const r = await res.json();\n    if (!res.ok) throw new Error(r.error || `HTTP ${res.status}`);\n    toast(`Se generaron ${r.generated} posts exitosamente`,'success');\n    loadDashboard();\n  } catch(e) { toast('Error: '+e.message,'danger'); }\n  finally { btn.disabled=false; sp.style.display='none'; btn.lastChild.textContent=' Generar 5 posts ahora'; }\n}\n\n// ── PENDING POSTS ──\nlet _cache={};\nasync function loadPendingPosts() {\n  const grid=document.getElementById('pending-grid');\n  grid.innerHTML='<div class=\"empty-state\" style=\"grid-column:1/-1\"><span>⏳</span><p>Cargando...</p></div>';\n  try {\n    const posts=await api('GET','/posts/pending');\n    _cache={}; posts.forEach(p=>{_cache[p.id]=p;});\n    grid.innerHTML=posts.length ? posts.map(p=>{\n      const badgeClass={pending:'badge-pending',approved:'badge-approved',rejected:'badge-rejected',published:'badge-published'}[p.status]||'';\n      const statusLabel={pending:'Pendiente',approved:'Aprobado',rejected:'Rechazado',published:'Publicado'}[p.status]||p.status;\n      const date=p.scheduled_time?new Date(p.scheduled_time).toLocaleString('es-GT',{dateStyle:'short',timeStyle:'short'}):'—';\n      return `<div class=\"post-card\">\n        <div class=\"post-image\">\n          ${p.image_url?`<img src=\"${p.image_url}\" onerror=\"this.parentElement.innerHTML='<div style=font-size:40px;color:#2e3347>🏠</div>'\">`:'<div style=\"font-size:40px;color:#2e3347\">🏠</div>'}\n          <span class=\"badge ${badgeClass}\">${statusLabel}</span>\n        </div>\n        <div class=\"post-body\">\n          <div class=\"post-theme\">${p.theme||'Sin tema'}</div>\n          <div class=\"post-caption\">${p.instagram_caption||p.content||''}</div>\n          <div class=\"post-hashtags\">${(p.hashtags||[]).slice(0,4).join(' ')}</div>\n        </div>\n        <div class=\"post-date\">📅 ${date}</div>\n        <div class=\"post-actions\">\n          ${p.status==='pending'?`<button class=\"btn btn-success btn-sm\" onclick=\"approvePost(${p.id})\">✓ Aprobar</button><button class=\"btn btn-danger btn-sm\" onclick=\"rejectPost(${p.id})\">✕</button>`:''}\n          ${p.status==='approved'?`<button class=\"btn btn-primary btn-sm\" onclick=\"openPublishModal(${p.id})\">📤 Publicar</button>`:''}\n          <button class=\"btn btn-ghost btn-sm\" onclick=\"openPostModal(${p.id})\">Ver</button>\n        </div>\n      </div>`;}).join('') : '<div class=\"empty-state\" style=\"grid-column:1/-1\"><span>✨</span><p>No hay posts pendientes.</p></div>';\n  } catch(e) { grid.innerHTML=`<div class=\"empty-state\" style=\"grid-column:1/-1\"><span>❌</span><p>${e.message}</p></div>`; }\n}\nasync function approvePost(id) {\n  try { await api('PUT',`/posts/${id}/approve`,{}); toast('Post aprobado ✓','success'); loadPendingPosts(); loadDashboard(); }\n  catch(e) { toast('Error: '+e.message,'danger'); }\n}\nasync function rejectPost(id) {\n  const notes=prompt('Motivo del rechazo (opcional):')||'';\n  try { await api('PUT',`/posts/${id}/reject`,{notes}); toast('Post rechazado'); loadPendingPosts(); loadDashboard(); }\n  catch(e) { toast('Error: '+e.message,'danger'); }\n}\nasync function publishPost(id) {\n  if(!confirm('¿Publicar este post en Instagram ahora?'))return;\n  try { await api('POST',`/posts/${id}/publish`); toast('Publicado en Instagram ✓','success'); loadPendingPosts(); loadDashboard(); }\n  catch(e) { toast('Error: '+e.message,'danger'); }\n}\n\n// ── POST MODAL ──\nfunction openPostModal(id) {\n  const p=_cache[id]; if(!p)return;\n  document.getElementById('modal-theme').textContent=p.theme||'Detalle';\n  document.getElementById('modal-body').innerHTML=`\n    <div class=\"form-group\"><label>Instagram Caption</label><textarea id=\"m-ig\" rows=\"5\">${p.instagram_caption||''}</textarea></div>\n    <div class=\"form-group\"><label>Facebook Caption</label><textarea id=\"m-fb\" rows=\"5\">${p.facebook_caption||''}</textarea></div>\n    <div class=\"form-group\"><label>Hashtags (uno por línea)</label><textarea id=\"m-tags\" rows=\"3\">${(p.hashtags||[]).join('\\n')}</textarea></div>\n    <div class=\"form-group\"><label>Descripción de imagen ideal</label><textarea rows=\"3\" readonly style=\"color:var(--muted)\">${p.image_description||'—'}</textarea></div>\n    <div class=\"form-group\"><label>Horario programado</label><input type=\"datetime-local\" id=\"m-sched\" value=\"${p.scheduled_time?p.scheduled_time.slice(0,16):''}\"></div>`;\n  document.getElementById('modal-actions').innerHTML=`\n    <button class=\"btn btn-ghost btn-sm\" onclick=\"closePostModal()\">Cancelar</button>\n    <button class=\"btn btn-primary btn-sm\" onclick=\"savePostEdits(${id})\">Guardar</button>\n    ${p.status==='pending'?`<button class=\"btn btn-success btn-sm\" onclick=\"approvePost(${id});closePostModal()\">Aprobar</button>`:''}`;\n  document.getElementById('post-modal').classList.add('open');\n}\nasync function savePostEdits(id) {\n  try {\n    await api('PUT',`/posts/${id}`,{ instagram_caption: document.getElementById('m-ig').value, facebook_caption: document.getElementById('m-fb').value, hashtags: document.getElementById('m-tags').value.split('\\n').map(h=>h.trim()).filter(Boolean), scheduled_time: document.getElementById('m-sched').value||null });\n    toast('Post actualizado ✓','success'); closePostModal(); loadPendingPosts();\n  } catch(e) { toast('Error: '+e.message,'danger'); }\n}\nfunction closePostModal() { document.getElementById('post-modal').classList.remove('open'); }\ndocument.getElementById('post-modal').addEventListener('click',e=>{if(e.target===document.getElementById('post-modal'))closePostModal();});\n\n// ── HISTORY ──\nasync function loadHistory() {\n  const cont=document.getElementById('history-list');\n  try {\n    const posts=await api('GET','/posts/published');\n    cont.innerHTML=posts.length?posts.map(p=>`\n      <div class=\"history-item\">\n        <div class=\"history-thumb\">${p.image_url?`<img src=\"${p.image_url}\" style=\"width:100%;height:100%;object-fit:cover\" onerror=\"this.parentElement.textContent='🏠'\">`:'🏠'}</div>\n        <div class=\"history-info\">\n          <div class=\"history-theme\">${p.theme||'Sin tema'}</div>\n          <div class=\"history-caption\">${p.instagram_caption||p.content||''}</div>\n          <div class=\"history-date\">📅 ${p.published_at?new Date(p.published_at).toLocaleString('es-GT',{dateStyle:'medium',timeStyle:'short'}):'—'}${p.instagram_post_id?` · <a href=\"https://instagram.com/p/${p.instagram_post_id}\" target=\"_blank\" style=\"color:var(--info)\">Ver en IG</a>`:''}</div>\n        </div>\n      </div>`).join(''):'<div class=\"empty-state\"><span>✅</span><p>Aún no hay posts publicados</p></div>';\n  } catch(e) { cont.innerHTML=`<div class=\"empty-state\"><span>❌</span><p>${e.message}</p></div>`; }\n}\n\n// ── GALLERY ──\nfunction renderImageCard(item, type) {\n  const deleteFunc = type === 'brand' ? `deleteBrandImage(${item.id})` : `deleteReference(${item.id})`;\n  const label = type === 'brand' ? (item.image_description || 'Sin descripción') : (item.reference_description || '');\n  return `<div style=\"background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden\">\n    <img src=\"${item.image_url}\" style=\"width:100%;height:130px;object-fit:cover\" onerror=\"this.style.display='none'\">\n    <div style=\"padding:8px;font-size:11px;color:var(--muted)\">\n      <div style=\"white-space:nowrap;overflow:hidden;text-overflow:ellipsis\">${label}</div>\n      <button class=\"btn btn-danger btn-sm\" style=\"width:100%;margin-top:6px\" onclick=\"${deleteFunc}\">Eliminar</button>\n    </div>\n  </div>`;\n}\n\nasync function loadGallery() {\n  try {\n    const [imgData, refData] = await Promise.all([\n      galleryApi('GET', '/brand-images'),\n      galleryApi('GET', '/references')\n    ]);\n    const images = imgData.images || [];\n    const references = refData.references || [];\n    document.getElementById('brand-images-grid').innerHTML = images.length\n      ? images.map(i => renderImageCard(i, 'brand')).join('')\n      : '<div class=\"empty-state\" style=\"grid-column:1/-1\"><span>📷</span><p>Sin imágenes aún</p></div>';\n    document.getElementById('references-grid').innerHTML = references.length\n      ? references.map(r => renderImageCard(r, 'ref')).join('')\n      : '<div class=\"empty-state\" style=\"grid-column:1/-1\"><span>🎨</span><p>Sin referencias aún</p></div>';\n  } catch(e) { toast('Error cargando galería: '+e.message,'danger'); }\n}\n\nconst GALLERY_BASE = '/api/gallery';\n\nasync function galleryApi(method, path, body) {\n  const res = await fetchWithAuth(GALLERY_BASE + path, {\n    method,\n    body: body ? JSON.stringify(body) : undefined\n  });\n  const data = await res.json();\n  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);\n  return data;\n}\n\nasync function addBrandImage() {\n  const file = document.getElementById('g-brand-file').files[0];\n  if (!file) { toast('Selecciona una imagen','danger'); return; }\n  const formData = new FormData();\n  formData.append('file', file);\n  formData.append('description', document.getElementById('g-brand-desc').value);\n  formData.append('category', document.getElementById('g-brand-cat').value);\n  formData.append('type', 'brand');\n  try {\n    const res = await fetch('/api/gallery/upload-image', {\n      method: 'POST',\n      headers: { 'Authorization': `Bearer ${getAuthToken()}` },\n      body: formData\n    });\n    const data = await res.json();\n    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);\n    document.getElementById('g-brand-file').value = '';\n    document.getElementById('g-brand-desc').value = '';\n    toast('Imagen subida ✓','success'); loadGallery();\n  } catch(e) { toast('Error: '+e.message,'danger'); }\n}\n\nasync function addReference() {\n  const file = document.getElementById('g-ref-file').files[0];\n  if (!file) { toast('Selecciona una imagen','danger'); return; }\n  const formData = new FormData();\n  formData.append('file', file);\n  formData.append('description', document.getElementById('g-ref-desc').value);\n  formData.append('what_to_copy', document.getElementById('g-ref-copy').value);\n  formData.append('type', 'reference');\n  try {\n    const res = await fetch('/api/gallery/upload-image', {\n      method: 'POST',\n      headers: { 'Authorization': `Bearer ${getAuthToken()}` },\n      body: formData\n    });\n    const data = await res.json();\n    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);\n    document.getElementById('g-ref-file').value = '';\n    document.getElementById('g-ref-desc').value = '';\n    document.getElementById('g-ref-copy').value = '';\n    toast('Referencia subida ✓','success'); loadGallery();\n  } catch(e) { toast('Error: '+e.message,'danger'); }\n}\n\nasync function deleteBrandImage(id) {\n  if (!confirm('¿Eliminar esta imagen?')) return;\n  try { await galleryApi('DELETE', `/brand-images/${id}`); loadGallery(); }\n  catch(e) { toast('Error: '+e.message,'danger'); }\n}\n\nasync function deleteReference(id) {\n  if (!confirm('¿Eliminar esta referencia?')) return;\n  try { await galleryApi('DELETE', `/references/${id}`); loadGallery(); }\n  catch(e) { toast('Error: '+e.message,'danger'); }\n}\n\n// ── PUBLISH MODAL ──\nlet _publishPostId = null;\nlet _publishImageUrl = null;\nlet _publishImagePrompt = '';\n\nasync function openPublishModal(postId) {\n  _publishPostId = postId;\n  _publishImageUrl = null;\n  document.getElementById('publish-img-preview').innerHTML = '<p style=\"color:var(--muted);margin:0;font-size:12px\">Vista previa de imagen seleccionada</p>';\n  document.getElementById('publish-img-grid').innerHTML = '<p style=\"color:var(--muted);font-size:12px\">Cargando...</p>';\n\n  // Obtener image_prompt del post desde los cacheados\n  const post = _cache[postId];\n  _publishImagePrompt = post?.image_description || 'Imagen profesional y atractiva';\n  document.getElementById('publish-img-prompt').textContent = _publishImagePrompt;\n\n  // Cargar galería\n  try {\n    const data = await galleryApi('GET', '/brand-images');\n    const images = data.images || [];\n    document.getElementById('publish-img-grid').innerHTML = images.length\n      ? images.map(img => `\n        <div id=\"pimg-${img.id}\" onclick=\"selectPublishImage(${img.id},'${img.image_url}')\"\n             style=\"cursor:pointer;border:2px solid transparent;border-radius:6px;overflow:hidden;transition:border-color .15s\">\n          <img src=\"${img.image_url}\" style=\"width:100%;height:100px;object-fit:cover\" onerror=\"this.style.opacity='.3'\">\n          <div style=\"background:var(--surface);padding:4px 6px;font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis\">${img.image_description || img.category || 'Imagen'}</div>\n        </div>`).join('')\n      : '<p style=\"color:var(--muted);font-size:12px;grid-column:1/-1\">Sin imágenes en galería. Súbelas en la pestaña Galería.</p>';\n  } catch(e) { document.getElementById('publish-img-grid').innerHTML = `<p style=\"color:var(--danger)\">${e.message}</p>`; }\n\n  document.getElementById('publish-modal').classList.add('open');\n}\n\nfunction selectPublishImage(id, url) {\n  _publishImageUrl = url;\n  document.querySelectorAll('[id^=\"pimg-\"]').forEach(el => el.style.borderColor = 'transparent');\n  document.getElementById(`pimg-${id}`).style.borderColor = 'var(--gold)';\n  document.getElementById('publish-img-preview').innerHTML = `<img src=\"${url}\" style=\"width:100%;height:200px;object-fit:cover;border-radius:4px\">`;\n}\n\nfunction copyImagePrompt() {\n  navigator.clipboard.writeText(_publishImagePrompt).then(() => toast('Prompt copiado ✓','success'));\n}\n\nfunction closePublishModal() {\n  document.getElementById('publish-modal').classList.remove('open');\n  _publishPostId = null;\n  _publishImageUrl = null;\n}\n\nasync function confirmPublish() {\n  try {\n    const res = await fetchWithAuth(`/api/marketing/publish-post/${_publishPostId}`, {\n      method: 'POST',\n      body: JSON.stringify({ image_url: _publishImageUrl })\n    });\n    const data = await res.json();\n    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);\n    toast('Post publicado ✓','success');\n    closePublishModal();\n    loadPendingPosts();\n    loadDashboard();\n  } catch(e) { toast('Error: '+e.message,'danger'); }\n}\n\ndocument.addEventListener('DOMContentLoaded', () => {\n  document.getElementById('publish-modal').addEventListener('click', e => {\n    if (e.target === document.getElementById('publish-modal')) closePublishModal();\n  });\n});\n\nloadDashboard();\n</script>\n</body>\n</html>\n");
});
app.get('/portal.html',          html('portal.html'));
app.get('/portal-cliente.html',  html('portal-cliente.html'));
app.get('/portal/cotizacion/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'portal', 'cotizacion.html')));
app.get('/landing.html',         html('landing.html'));
app.get('/real-estate.html',html('real-estate.html'));
app.get('/as-built.html',   html('as-built.html'));
app.get('/construccion.html',html('construccion.html'));

app.get('/privacy', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Política de Privacidad — Virtual Estate GT</title><style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 24px;color:#1a1a1a;line-height:1.7}h1{color:#2D5016}h2{color:#2D5016;font-size:1.1rem;margin-top:2rem}a{color:#2D5016}footer{margin-top:3rem;padding-top:1rem;border-top:1px solid #ddd;font-size:.85rem;color:#666}</style></head><body><h1>Política de Privacidad</h1><p><strong>Virtual Estate GT</strong> — Última actualización: mayo 2026</p><h2>1. Información que recopilamos</h2><p>Recopilamos información que usted nos proporciona directamente, como nombre, correo electrónico, número de teléfono y detalles sobre propiedades de interés cuando utiliza nuestros formularios de contacto o cotización.</p><h2>2. Uso de la información</h2><p>Utilizamos la información recopilada para: responder consultas y solicitudes, enviar cotizaciones y propuestas, mejorar nuestros servicios de fotografía y escaneo 3D, y comunicarnos sobre proyectos en curso.</p><h2>3. Compartir información</h2><p>No vendemos ni compartimos su información personal con terceros, excepto cuando sea necesario para prestar el servicio solicitado o cuando la ley lo requiera.</p><h2>4. Cookies</h2><p>Nuestro sitio web puede utilizar cookies técnicas necesarias para el funcionamiento básico. No utilizamos cookies de rastreo publicitario de terceros.</p><h2>5. Seguridad</h2><p>Implementamos medidas de seguridad razonables para proteger su información. Los datos se almacenan en servidores seguros con cifrado.</p><h2>6. Sus derechos</h2><p>Usted puede solicitar acceso, corrección o eliminación de sus datos personales escribiéndonos a <a href="mailto:info@virtualestategt.com">info@virtualestategt.com</a>.</p><h2>7. Contacto</h2><p>Para cualquier consulta sobre esta política, contáctenos en: <a href="mailto:info@virtualestategt.com">info@virtualestategt.com</a></p><footer><a href="/">← Volver al inicio</a> &nbsp;|&nbsp; <a href="/terms">Términos de Servicio</a></footer></body></html>`);
});

app.get('/terms', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Términos de Servicio — Virtual Estate GT</title><style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 24px;color:#1a1a1a;line-height:1.7}h1{color:#2D5016}h2{color:#2D5016;font-size:1.1rem;margin-top:2rem}a{color:#2D5016}footer{margin-top:3rem;padding-top:1rem;border-top:1px solid #ddd;font-size:.85rem;color:#666}</style></head><body><h1>Términos de Servicio</h1><p><strong>Virtual Estate GT</strong> — Última actualización: mayo 2026</p><h2>1. Aceptación de términos</h2><p>Al utilizar los servicios de Virtual Estate GT, usted acepta estos términos. Si no está de acuerdo, por favor no utilice nuestros servicios.</p><h2>2. Descripción del servicio</h2><p>Virtual Estate GT ofrece servicios de fotografía inmobiliaria profesional, escaneo 3D, tours virtuales y producción de contenido visual para el sector inmobiliario en Guatemala.</p><h2>3. Uso aceptable</h2><p>Usted se compromete a utilizar nuestros servicios únicamente para fines legales y a no reproducir, distribuir o utilizar comercialmente el contenido producido por Virtual Estate GT sin autorización escrita previa.</p><h2>4. Propiedad intelectual</h2><p>Todo el contenido producido por Virtual Estate GT (fotografías, modelos 3D, videos) es propiedad de Virtual Estate GT hasta la entrega y pago completo del servicio contratado, momento en que los derechos de uso se transfieren al cliente según lo acordado.</p><h2>5. Pagos y cancelaciones</h2><p>Los términos de pago, anticipos y políticas de cancelación se establecen en la cotización o contrato individual de cada proyecto.</p><h2>6. Limitación de responsabilidad</h2><p>Virtual Estate GT no será responsable por daños indirectos, incidentales o consecuentes derivados del uso de nuestros servicios más allá del monto pagado por el servicio específico.</p><h2>7. Modificaciones</h2><p>Nos reservamos el derecho de modificar estos términos en cualquier momento. Los cambios serán publicados en esta página.</p><h2>8. Contacto</h2><p>Para consultas sobre estos términos: <a href="mailto:info@virtualestategt.com">info@virtualestategt.com</a></p><footer><a href="/">← Volver al inicio</a> &nbsp;|&nbsp; <a href="/privacy">Política de Privacidad</a></footer></body></html>`);
});

// Assets estáticos (imágenes, documentos)
app.use('/assets',    express.static(path.join(__dirname, 'public', 'assets'), { dotfiles: 'ignore' }));
app.use('/assets',    express.static(path.join(__dirname, 'images', 'assets'), { dotfiles: 'ignore' }));
app.use('/images',    express.static(path.join(__dirname, 'images'),    { dotfiles: 'ignore' }));
app.use('/documentos',express.static(path.join(__dirname, 'documentos'),{ dotfiles: 'ignore' }));

// ============================================================
// WHATSAPP WEBHOOK — Meta Business API
// ============================================================

const _waSupabase = require('./src/config/supabase');

async function _waGenerateResponse(phone, userMessage) {
  console.log('[WA] _waGenerateResponse — CLAUDE_API_KEY present:', !!process.env.CLAUDE_API_KEY, '— key prefix:', (process.env.CLAUDE_API_KEY || '').slice(0, 10));
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

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

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: `Eres tu asistente virtual de Virtual Estate GT, especializado en real estate, escaneo 3D, fotografía inmobiliaria, documentación técnica y servicios de construcción en Guatemala.

ACLARACIÓN INICIAL (solo primer contacto):
"Soy tu asistente virtual preparado para responder tus consultas. Si en algún momento necesitas atención personalizada de un agente, te conectaremos con alguien del equipo real."

IDENTIDAD Y TONO:
- Responde como si fueras un miembro del equipo real
- Amigable, profesional, conciso
- Usa "nosotros" al hablar de la empresa
- NUNCA menciones nombres de personas específicas
- NUNCA inventes información

CANALES DE CONTACTO (ÚNICOS):
- WhatsApp: +502 39902399
- Facebook Messenger: facebook.com/virtualestategt
- Instagram: @virtualestategt
- Email: info@virtualestategt.com
- Página web: www.virtualestategt.com

SERVICIOS OFRECIDOS:
1. Real estate 🏠 (venta y alquiler de propiedades)
2. Escaneo 3D 📐 de propiedades
3. Fotografía inmobiliaria 📸 profesional
4. Tours virtuales 🎥 interactivos
5. Documentación técnica 📋 y planos as-built
6. Servicios de construcción 🔨 y ejecución de obras

PRECIOS (INFORMACIÓN PERMITIDA):

ESCANEO 3D:
- Precio mínimo: $150 USD / Q1,200
- Sujeto a medidas reales de la propiedad y ubicación
- Frase: "El precio final depende de las medidas exactas, complejidad y ubicación"

CONSTRUCCIÓN:
- Presupuestos personalizados (demoran más tiempo - proceso manual)
- NO dar presupuestos rápidos, recopilar información completa
- "Nuestro equipo de construcción revisará tu proyecto y te enviará un presupuesto detallado en breve"

RESPUESTAS A PREGUNTAS FRECUENTES:

"¿Qué servicios ofrecen?"
→ "Ofrecemos: 1. Real estate 🏠, 2. Escaneo 3D 📐, 3. Fotografía inmobiliaria 📸, 4. Tours virtuales 🎥, 5. Documentación técnica 📋, 6. Servicios de construcción 🔨. ¿Cuál te interesa?"

"¿Cuál es el precio?"
→ "Precio mínimo de escaneo: $150 USD / Q1,200. El precio final depende de medidas exactas, complejidad y ubicación. ¿Tienes una propiedad en mente?"

"¿Dónde están ubicados?"
→ "Operamos en toda Guatemala. Para detalles y ver nuestro portafolio, visita www.virtualestategt.com"

"¿Cómo agendar?"
→ "Disponemos L-V de 8am-6pm. Cuéntanos qué necesitas y coordinamos al instante."

"¿Ven propiedades en [ZONA]?"
→ "¿Cuál es la ubicación específica? Nos gustaría validar si podemos asistirte. De momento contamos con cobertura en la mayoría de zonas, pero algunos casos especiales los evaluamos individualmente."

RESPUESTAS SECCIONADAS (IMPORTANTE):
- Responde SOLO sobre el servicio/tema que el cliente preguntó
- NO ofrezcas múltiples servicios en un mismo mensaje
- Espera su próxima pregunta antes de ampliar
- Esto mantiene conversación natural y no saturada

CUANDO EL CLIENTE SOLICITA COTIZACIÓN:
Solicita TODOS estos datos:
- Nombre completo
- Correo electrónico
- Teléfono
- Ubicación exacta de la propiedad
- Descripción del proyecto / qué necesita
- Tipo de servicio (escaneo, construcción, otro)
- (Opcional) Si tiene código de cliente o código de agente asignado

RESPUESTA AL CLIENTE:
"Perfecto, tomaremos tu solicitud. Nuestro equipo estará procesando tu [cotización/solicitud] y te la haremos llegar en breve."

IMPORTANTE:
- NO envíes cotización automáticamente — espera aprobación del owner
- NO ofrezcas cotización de entrada (espera a que cliente la solicite o se vea clara intención)
- Solo sugiere cotización cuando haya interés real demostrado

ORIENTACIÓN SOBRE SERVICIOS:
Siempre que un cliente consulte por un servicio, indícale para qué es IDEAL:
- "El escaneo 3D es ideal para: [caso de uso]. ¿Es tu caso?"
- "La fotografía inmobiliaria es perfecta para: [caso de uso]. ¿Te interesa?"
- Así orientas hacia el servicio que realmente necesita

CUANDO NO SEPAS LA RESPUESTA:

CASO 1 - Respuestas simples/básicas que debes validar:
→ "Déjanos validar esa información y te respondemos en breve" (30-40 seg max)

CASO 2 - Preguntas complejas/sensibles:
→ Lanza alerta al owner → espera aprobación → envía respuesta aprobada

NUNCA digas "no sé" al cliente.

Si pasaron 5+ minutos sin aprobación:
→ "Nuestro equipo está revisando tu consulta detalladamente. Te responderemos cuanto antes con la información más precisa."

HORARIOS Y DISPONIBILIDAD:
- Responder consultas: 24/7 (este chat)
- Agendar servicios/visitas: L-V 8am-6pm

Si cliente pide servicio fuera de horario laboral:
→ "Tomaremos tu solicitud. Mañana cuando iniciemos labores (8am) un agente se pondrá en contacto para coordinar. ¡Gracias por tu paciencia!"

MENSAJE DE BIENVENIDA (FIJO):
Solo enviar cuando detectes nuevo chat (después de 3h inactividad y cliente vuelve a escribir O primer contacto)

"¡Hola! 👋 Bienvenido/a a Virtual Estate GT. Soy tu asistente virtual y estoy aquí para ayudarte.

Somos especialistas en:
1. Real estate 🏠
2. Escaneo 3D 📐
3. Fotografía inmobiliaria 📸
4. Tours virtuales 🎥
5. Documentación técnica 📋
6. Servicios de construcción 🔨

¿Qué necesitas hoy?
(Puedes escribir el número o tu pregunta)"

RECORDATORIO DESPUÉS DE 1 HORA INACTIVIDAD:
"¿Aún tienes dudas? Aquí seguimos para ayudarte 😊

(Nota: Este chat se reiniciará después de 3 horas de inactividad para mejor servicio)"

OPCIONES NUMERADAS:
- Cliente puede escribir número (1, 2, 3) O pregunta completa
- Acepta ambas formas sin error

SOBRE PROPIEDADES Y PORTAFOLIO:

"¿Tienen propiedades disponibles?"
→ "Sí, visita www.virtualestategt.com donde encontrarás nuestro portafolio completo con filtros de búsqueda personalizables (zona, tipo, precio, etc). Puedes crear tu perfil y armar tu carrito con propiedades de tu interés."

"¿Pueden sugerir propiedades?"
→ "Claro, cuéntame qué buscas (zona, tipo, presupuesto) y te sugiero opciones. Luego tú armas tu carrito en el portal para guardar y comparar propiedades."

IMPORTANTE:
- Puedes SUGERIR propiedades pero NO armas el carrito por ellos
- Ellos deben crear su perfil y armar carrito en www.virtualestategt.com
- Esto mantiene engagement en web + tracking real de clientes

NO MENCIONAR NUNCA:
- Nombres de personas
- Teléfono +50251272731 (inválido)
- Precios por metro cuadrado
- Que "no sabes" algo
- Que eres IA (solo mencionar al inicio que eres asistente virtual)

GESTIÓN DE CONVERSACIONES:

DESPUÉS DE 1 HORA DE INACTIVIDAD:
→ Enviar recordatorio con nota de reinicio

DESPUÉS DE 3 HORAS DE INACTIVIDAD:
→ Borra silenciosamente el historial del chat
→ Cuando cliente vuelva a escribir → envía mensaje de bienvenida (nuevo chat)
→ TRACKING: Los datos siempre se guardan en prospect_tracking (para métrica de contactos)`,
      messages: historyMessages
    });

    return response.content[0].text;
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

async function _waWebhookPost(req, res) {
  console.log('[WA] 1. Webhook recibido:', JSON.stringify(req.body, null, 2));

  try {
    const entry   = req.body?.entry?.[0];
    const changes = entry?.changes?.[0]?.value;
    const msg     = changes?.messages?.[0];

    // Log phone_number_id para diagnóstico de configuración
    const incomingPhoneId = changes?.metadata?.phone_number_id;
    const configuredId    = process.env.WHATSAPP_PHONE_NUMBER_ID;
    console.log('[WA] 2.7 WHATSAPP_PHONE_NUMBER_ID — incoming:', incomingPhoneId, '— configured:', configuredId, '— match:', incomingPhoneId === configuredId);

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

    console.log('[WA] from:', phone, '—', isOwner ? 'OWNER' : 'externo', '— isCommand:', isCommand, '— text:', text);

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
      console.log('[WA] prospect_tracking new lead:', phone);
    }

    // ── Comandos owner ────────────────────────────────────────────────────
    if (isOwner && isCommand) {
      const cmd = text.trim().split(/\s+/)[0]?.toLowerCase();
      console.log('[WA] from:', phone, '— OWNER detected — command:', cmd);
      const reply = await _waHandleOwnerCommand(phone, text);
      await _waSendMessage(phone, reply);
      console.log('[WA] Owner command response sent:', reply);
      res.sendStatus(200);
      return;
    }

    // ── PASO 4: Verificar contact_type ───────────────────────────────────
    console.log('[WA] Consultando contact_type para:', phone, '...');
    const { data: contact, error: contactErr } = await _waSupabase
      .from('whatsapp_contacts')
      .select('contact_type, respond, name')
      .eq('phone_number', phone)
      .single();

    if (contactErr && contactErr.code !== 'PGRST116') {
      console.error('[WA] Error consultando contacto:', contactErr.message, contactErr.code);
    }

    const contactType = contact?.contact_type || 'null';
    const esPersonal  = contactType === 'personal' || contact?.respond === false;
    console.log('[WA] contact_type:', contactType, '— Decisión:', esPersonal ? 'NO responder' : 'responder SI');

    if (esPersonal) {
      console.log('[WA] Número', phone, 'es personal — sin respuesta.');
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
      console.log('[WA] 6. Éxito — mensaje enviado a', phone);
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
