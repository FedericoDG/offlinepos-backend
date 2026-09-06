import { PagoService } from './pago.service';
import { FiltroPagoDTO, RegistrarPagoDTO } from './pago.dtos';
import { handleApiError } from '../../utils/api-error';
const pagoService = new PagoService();
export class PagoController {
    async registrar(req, res) {
        try {
            const data = RegistrarPagoDTO.parse(req.body);
            res.status(201).json(await pagoService.registrar(data));
        }
        catch (error) {
            handleApiError(error, res, 'Error al registrar el pago');
        }
    }
    async getAll(req, res) {
        try {
            const filtro = FiltroPagoDTO.parse(req.query);
            const [pagina, total_monto] = await Promise.all([
                pagoService.getAll(filtro),
                pagoService.totalFiltrado(filtro),
            ]);
            res.status(200).json({ ...pagina, total_monto });
        }
        catch (error) {
            handleApiError(error, res, 'Error al listar los pagos');
        }
    }
    async getById(req, res) {
        try {
            res.status(200).json(await pagoService.getById(req.params.id));
        }
        catch (error) {
            handleApiError(error, res, 'Error al obtener el pago');
        }
    }
    async eliminar(req, res) {
        try {
            await pagoService.eliminar(req.params.id);
            res.status(200).json({ message: 'Pago eliminado correctamente' });
        }
        catch (error) {
            handleApiError(error, res, 'Error al eliminar el pago');
        }
    }
}
