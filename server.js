require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const authMiddleware = require('./src/middleware/auth');

app.use(cors());
app.use(express.json());

// Auth (pública — sin protección)
const authRouter = require('./src/routes/auth');
app.use('/api/auth', authRouter);

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

// Archivos estáticos (HTML, imágenes, etc.) — después de las rutas API
// dotfiles:'ignore' evita que .env sea accesible por HTTP
app.use(express.static(__dirname, { dotfiles: 'ignore' }));

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
