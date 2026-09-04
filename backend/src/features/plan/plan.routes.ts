import { Router } from 'express';
import { PlanController } from './plan.controller';
import { authenticateJWT, requireAdmin } from '../../middlewares/auth.middleware';

const router = Router();
const planController = new PlanController();

router.use(authenticateJWT, requireAdmin);

router.get('/', (req, res) => planController.getAll(req, res));
router.post('/', (req, res) => planController.crear(req, res));
router.get('/:id', (req, res) => planController.getById(req, res));
router.put('/:id', (req, res) => planController.actualizar(req, res));
router.patch('/:id/desactivar', (req, res) => planController.desactivar(req, res));
router.delete('/:id', (req, res) => planController.eliminar(req, res));

export default router;
