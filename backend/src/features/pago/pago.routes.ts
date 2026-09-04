import { Router } from 'express';
import { PagoController } from './pago.controller';
import { authenticateJWT, requireAdmin } from '../../middlewares/auth.middleware';

const router = Router();
const pagoController = new PagoController();

router.use(authenticateJWT, requireAdmin);

router.get('/', (req, res) => pagoController.getAll(req, res));
router.post('/', (req, res) => pagoController.registrar(req, res));
router.get('/:id', (req, res) => pagoController.getById(req, res));
router.delete('/:id', (req, res) => pagoController.eliminar(req, res));

export default router;
