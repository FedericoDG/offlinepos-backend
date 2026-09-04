import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { env } from './config/env';
import prisma from './config/prisma';
import administradorRoutes from './features/administrador/administrador.routes';
import comercioRoutes from './features/comercio/comercio.routes';
import licenciaRoutes from './features/licencia/licencia.routes';
import licenciaPanelRoutes from './features/licencia/licencia.panel.routes';
import planRoutes from './features/plan/plan.routes';
import suscripcionRoutes from './features/suscripcion/suscripcion.routes';
import pagoRoutes from './features/pago/pago.routes';
import estadisticaRoutes from './features/estadistica/estadistica.routes';

const app = express();

// Middlewares globales
app.use(cors({
  origin: env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN.split(','),
  credentials: true,
}));
app.use(compression());
app.use(express.json());

// Rutas
app.use('/api/administradores', administradorRoutes);
app.use('/api/comercios', comercioRoutes);
app.use('/api/licencias', licenciaRoutes);
// Rutas del panel. Va despues del router de arriba, que no las define.
app.use('/api/licencias', licenciaPanelRoutes);
app.use('/api/planes', planRoutes);
app.use('/api/suscripciones', suscripcionRoutes);
app.use('/api/pagos', pagoRoutes);
app.use('/api/estadisticas', estadisticaRoutes);

app.get('/health', async (_req, res) => {
  try {
    // Verifica que Postgres responda
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected', env: env.NODE_ENV });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected', env: env.NODE_ENV });
  }
});

app.listen(env.PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${env.PORT}`);
});
