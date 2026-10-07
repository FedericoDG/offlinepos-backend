import { Router } from 'express';
import { AdministradorController } from './administrador.controller';
import { authenticateJWT, requireAdmin } from '../../middlewares/auth.middleware';

const router = Router();
const administradorController = new AdministradorController();

// Login publico: queda antes del middleware para que no exija token.
router.post('/login', (req, res) => administradorController.login(req, res));

// Todo el ABM de administradores va detras del mismo JWT de admin del panel.
router.use(authenticateJWT, requireAdmin);

router.get('/', (req, res) => administradorController.getAll(req, res));
router.post('/', (req, res) => administradorController.crear(req, res));
router.put('/:id', (req, res) => administradorController.actualizar(req, res));
router.delete('/:id', (req, res) => administradorController.eliminar(req, res));
router.post('/:id/reset-password', (req, res) => administradorController.resetPassword(req, res));
router.patch('/:id/activo', (req, res) => administradorController.cambiarActivo(req, res));

export default router;
