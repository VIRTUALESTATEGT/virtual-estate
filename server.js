require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());
// Rutas
// Rutas
const leadsRouter = require('./src/routes/leads');
const clientesRouter = require('./src/routes/clientes');
const propiedadesRouter = require('./src/routes/propiedades');
const proyectosRouter = require('./src/routes/proyectos');
const cotizacionesRouter = require('./src/routes/cotizaciones');
const agentesRouter = require('./src/routes/agentes');
// Auth
const authRouter = require('./src/routes/auth');
app.use('/api/auth', authRouter);

app.use('/api/leads', leadsRouter);
app.use('/api/clientes', clientesRouter);
app.use('/api/propiedades', propiedadesRouter);
app.use('/api/proyectos', proyectosRouter);
app.use('/api/cotizaciones', cotizacionesRouter);
app.use('/api/agentes', agentesRouter);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});