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
import chatRoutes from './features/chat/chat.routes';
import actualizacionesRoutes from './features/actualizaciones/actualizaciones.routes';
import { dirUpdates } from './features/actualizaciones/actualizaciones.service';

const app = express();

// Ngrok (y otros proxies) reenvían la IP real en X-Forwarded-For: sin trust
// proxy, express-rate-limit contaría todo contra la misma IP del túnel.
app.set('trust proxy', 1);

import rateLimit from 'express-rate-limit';

// Límite default: malla de seguridad para cualquier otra ruta no listada abajo.
const limiterDefault = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    req.path.startsWith('/api/licencias/activar') ||
    req.path.startsWith('/api/administradores/login') ||
    req.path.startsWith('/api/chat'),
});
const limiterActivar = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});
const limiterLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});
const limiterChat = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// Middlewares globales
app.use(cors({
  origin: env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN.split(','),
  credentials: true,
}));
app.use(compression({
  filter: (req, res) => {
    if (req.path.includes('/stream')) return false;
    return compression.filter(req, res);
  },
}));
app.use(express.json());

// /health sin límite: lo patean healthchecks de Docker/negroni.

// Aplicar límites antes de las rutas (orden importa).
app.use('/api/licencias/activar', limiterActivar);
app.use('/api/administradores/login', limiterLogin);
app.use('/api/chat', limiterChat);
app.use('/api', limiterDefault);

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
app.use('/api/chat', chatRoutes);
app.use('/api/updates/admin', actualizacionesRoutes);

// Descarga de versiones del POS (pública: el updater hace GET sin auth;
// la confianza viene de la firma minisign embebida en el binario).
app.use('/api/updates', express.static(dirUpdates(), {
  maxAge: '1h',
  setHeaders: (res, ruta) => {
    // latest.json nunca cacheado: es lo primero que consulta el updater.
    if (ruta.endsWith('latest.json')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));

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
