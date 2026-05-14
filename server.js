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

app.use(express.json());

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
const agenteSolicitudRouter = require('./src/routes/agente-solicitud');

const { requireMinRole, requirePortalOrStaff, requireSuperadmin } = require('./src/middleware/roles');

app.use('/api/leads',         authMiddleware, requireMinRole('asistente'), leadsRouter);
app.use('/api/clientes',      authMiddleware, requirePortalOrStaff('asistente'), clientesRouter);
app.use('/api/propiedades',   authMiddleware, requireMinRole('asistente'), propiedadesRouter);
app.use('/api/proyectos',     authMiddleware, requireMinRole('asistente'), proyectosRouter);
app.use('/api/cotizaciones',  authMiddleware, requireMinRole('asistente'), cotizacionesRouter);
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
app.get('/admin.html',      html('admin.html'));
app.get('/portal.html',          html('portal.html'));
app.get('/portal-cliente.html',  html('portal-cliente.html'));
app.get('/landing.html',         html('landing.html'));
app.get('/real-estate.html',html('real-estate.html'));
app.get('/as-built.html',   html('as-built.html'));
app.get('/construccion.html',html('construccion.html'));

// Assets estáticos (imágenes, documentos)
app.use('/assets',    express.static(path.join(__dirname, 'images', 'assets'), { dotfiles: 'ignore' }));
app.use('/images',    express.static(path.join(__dirname, 'images'),    { dotfiles: 'ignore' }));
app.use('/documentos',express.static(path.join(__dirname, 'documentos'),{ dotfiles: 'ignore' }));

// Exportar el app para Vercel (api/index.js lo importa)
module.exports = app;

// app.listen solo cuando se corre directamente (desarrollo local)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
  });
}
