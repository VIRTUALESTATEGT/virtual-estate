require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const authMiddleware = require('./src/middleware/auth');

app.use(cors());
app.use(express.json());

// Auth (pública — sin protección)
const authRouter = require('./src/routes/auth');
app.use('/api/auth', authRouter);

// Public endpoints — no auth
const supabasePublic = require('./src/config/supabase');

app.get('/api/propiedades/public', async (req, res) => {
  try {
    const { data, error } = await supabasePublic
      .from('propiedades')
      .select('id,nombre,tipo,modalidad,precio,m2,zona,linktour3d')
      .order('id', { ascending: false });
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

// Rutas protegidas con JWT
const leadsRouter = require('./src/routes/leads');
const clientesRouter = require('./src/routes/clientes');
const propiedadesRouter = require('./src/routes/propiedades');
const proyectosRouter = require('./src/routes/proyectos');
const cotizacionesRouter = require('./src/routes/cotizaciones');
const agentesRouter = require('./src/routes/agentes');

app.use('/api/leads', authMiddleware, leadsRouter);
app.use('/api/clientes', authMiddleware, clientesRouter);
app.use('/api/propiedades', authMiddleware, propiedadesRouter);
app.use('/api/proyectos', authMiddleware, proyectosRouter);
app.use('/api/cotizaciones', authMiddleware, cotizacionesRouter);
app.use('/api/agentes', authMiddleware, agentesRouter);

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
app.get('/portal.html',     html('portal.html'));
app.get('/landing.html',    html('landing.html'));
app.get('/real-estate.html',html('real-estate.html'));
app.get('/as-built.html',   html('as-built.html'));
app.get('/construccion.html',html('construccion.html'));

// Assets estáticos (imágenes, documentos)
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
