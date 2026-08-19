import { Router } from 'express';
import { ComercioController } from './comercio.controller';
import { authenticateJWT, requireAdmin } from '../../middlewares/auth.middleware';
const router = Router();
const comercioController = new ComercioController();
// Todas las rutas de comercios requieren autenticación JWT y rol ADMINISTRADOR
router.use(authenticateJWT, requireAdmin);
router.post('/', (req, res) => comercioController.create(req, res));
router.get('/', (req, res) => comercioController.getAll(req, res));
router.get('/:id', (req, res) => comercioController.getById(req, res));
router.put('/:id', (req, res) => comercioController.update(req, res));
router.delete('/:id', (req, res) => comercioController.delete(req, res));
export default router;
