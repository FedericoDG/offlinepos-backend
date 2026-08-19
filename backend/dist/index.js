import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { env } from './config/env';
import './config/prisma';
import administradorRoutes from './features/administrador/administrador.routes';
import comercioRoutes from './features/comercio/comercio.routes';
import licenciaRoutes from './features/licencia/licencia.routes';
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
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', environment: env.NODE_ENV });
});
app.listen(env.PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${env.PORT}`);
});
