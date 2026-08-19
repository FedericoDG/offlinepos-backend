import { Router } from 'express';
import { AdministradorController } from './administrador.controller';
const router = Router();
const administradorController = new AdministradorController();
router.post('/login', (req, res) => administradorController.login(req, res));
export default router;
