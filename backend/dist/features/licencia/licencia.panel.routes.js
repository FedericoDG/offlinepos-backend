import { Router } from 'express';
import { FiltroLicenciaDTO, LicenciaPanelService } from './licencia.panel';
import { authenticateJWT, requireAdmin } from '../../middlewares/auth.middleware';
import { handleApiError } from '../../utils/api-error';
/**
 * Router del panel para licencias. Se monta sobre el mismo `/api/licencias`
 * que `licencia.routes.ts`, despues de el: Express prueba los routers en orden
 * y el primero no define ninguna de estas rutas, asi que caen aca.
 *
 * Estan separados para que el archivo por el que pasa la activacion del POS
 * quede como esta, sin que las pantallas del panel lo obliguen a cambiar.
 */
const router = Router();
const servicio = new LicenciaPanelService();
router.use(authenticateJWT, requireAdmin);
router.get('/', async (req, res) => {
    try {
        const filtro = FiltroLicenciaDTO.parse(req.query);
        res.status(200).json(await servicio.listar(filtro));
    }
    catch (error) {
        handleApiError(error, res, 'Error al listar las licencias');
    }
});
/** Cambio de PC: libera el puesto para que lo tome la maquina nueva. */
router.delete('/:id/activaciones/:activacionId', async (req, res) => {
    try {
        const resultado = await servicio.liberarActivacion(req.params.id, req.params.activacionId);
        res.status(200).json(resultado);
    }
    catch (error) {
        handleApiError(error, res, 'Error al liberar la instalacion');
    }
});
export default router;
