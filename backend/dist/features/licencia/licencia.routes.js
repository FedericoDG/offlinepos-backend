import { Router } from 'express';
import { LicenciaController } from './licencia.controller';
import { authenticateJWT, requireAdmin } from '../../middlewares/auth.middleware';
const router = Router();
const licenciaController = new LicenciaController();
// Endpoint protegido (solo administradores): emite licencias con rol
router.post('/', authenticateJWT, requireAdmin, (req, res) => licenciaController.crear(req, res));
// Endpoint público para activar licencia
router.post('/activar', (req, res) => licenciaController.activar(req, res));
export default router;
