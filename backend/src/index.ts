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
import { dirUpdates, repararLatest } from './features/actualizaciones/actualizaciones.service';
import { resolverBasePublica } from './utils/base-publica';

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
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Salud del backend. Se expone DOS veces:
// - `/health`: para healthchecks de Docker/negroni, sin límite de tasa.
// - `/api/health`: el POS desktop valida conectividad contra
//   `{BACKEND_URL}/health`, y en produccion `BACKEND_URL` ya incluye el
//   prefijo del API (nginx reescribe `/api-pos-offline/` → `/api/`).
// Por eso se registra ANTES de los limiters: el POS lo consulta cada 5s y no
// debe consumir la cuota general.
const salud = async (_req: express.Request, res: express.Response) => {
  try {
    // Verifica que Postgres responda
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected', env: env.NODE_ENV });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected', env: env.NODE_ENV });
  }
};
app.get('/health', salud);
app.get('/api/health', salud);

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

// Auto-reparación de latest.json: un archivo publicado antes de configurar
// PUBLIC_BASE_URL puede tener URLs con localhost. Antes de servir el estático,
// reescribimos sus platforms[*].url con el origen de ESTE request. Es seguro
// porque la firma minisign cubre el artefacto descargado, no la URL. Si el
// archivo no existe, seguimos al static, que devuelve 404 como siempre.
app.get('/api/updates/latest.json', (req, res, next) => {
  try {
    repararLatest(resolverBasePublica(req));
  } catch {
    /* si la reparación falla, servimos lo que haya sin romper la descarga */
  }
  next();
});

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

// Aviso de configuración en producción: sin PUBLIC_BASE_URL real, las URLs
// absolutas (descargas del updater y link móvil del chat) quedan atadas al
// host del request, que detrás de un proxy puede no ser el correcto.
if (
  env.NODE_ENV === 'production' &&
  (env.PUBLIC_BASE_URL.includes('localhost') || env.PUBLIC_BASE_URL.includes('127.0.0.1'))
) {
  console.warn(
    '[Config] NODE_ENV=production pero PUBLIC_BASE_URL es localhost/127.0.0.1: ' +
      'las URLs absolutas de descarga y del link móvil van a depender del host del request. ' +
      'Configurá PUBLIC_BASE_URL con el dominio público real (ej. https://vps1-binario.duckdns.org).',
  );
}

app.listen(env.PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${env.PORT}`);
});
