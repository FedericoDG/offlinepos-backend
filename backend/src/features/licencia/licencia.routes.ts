import { Router } from 'express';
import { LicenciaController } from './licencia.controller';

const router = Router();
const licenciaController = new LicenciaController();

// Endpoint público para activar licencia
router.post('/activar', (req, res) => licenciaController.activar(req, res));

export default router;
