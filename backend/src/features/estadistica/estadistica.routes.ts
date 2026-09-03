import { Router } from 'express';
import { EstadisticaController } from './estadistica.controller';
import { authenticateJWT, requireAdmin } from '../../middlewares/auth.middleware';

const router = Router();
const estadisticaController = new EstadisticaController();

router.use(authenticateJWT, requireAdmin);

router.get('/resumen', (req, res) => estadisticaController.resumen(req, res));
router.get('/ingresos-mensuales', (req, res) => estadisticaController.ingresosMensuales(req, res));
router.get('/ingresos-por-plan', (req, res) => estadisticaController.ingresosPorPlan(req, res));
router.get('/proximos-vencimientos', (req, res) => estadisticaController.proximosVencimientos(req, res));

export default router;
