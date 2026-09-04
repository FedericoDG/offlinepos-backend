import { Router } from 'express';
import { SuscripcionController } from './suscripcion.controller';
import { authenticateJWT, requireAdmin } from '../../middlewares/auth.middleware';

const router = Router();
const suscripcionController = new SuscripcionController();

router.use(authenticateJWT, requireAdmin);

router.get('/', (req, res) => suscripcionController.getAll(req, res));
router.post('/', (req, res) => suscripcionController.crear(req, res));
router.get('/:id', (req, res) => suscripcionController.getById(req, res));
router.put('/:id', (req, res) => suscripcionController.actualizar(req, res));
router.post('/:id/renovar', (req, res) => suscripcionController.renovar(req, res));
router.post('/:id/cancelar', (req, res) => suscripcionController.cancelar(req, res));
router.delete('/:id', (req, res) => suscripcionController.eliminar(req, res));

export default router;
