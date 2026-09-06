import { Router } from 'express';
import { ChatController } from './chat.controller';
const router = Router();
const chatController = new ChatController();
router.post('/mensajes', (req, res) => chatController.preguntar(req, res));
router.post('/resultado', (req, res) => chatController.resultado(req, res));
export default router;
