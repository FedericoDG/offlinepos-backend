import { SuscripcionService } from './suscripcion.service';
import { ActualizarSuscripcionDTO, CrearSuscripcionDTO, FiltroSuscripcionDTO, RenovarSuscripcionDTO, } from './suscripcion.dtos';
import { handleApiError } from '../../utils/api-error';
const suscripcionService = new SuscripcionService();
export class SuscripcionController {
    async crear(req, res) {
        try {
            const data = CrearSuscripcionDTO.parse(req.body);
            res.status(201).json(await suscripcionService.crear(data));
        }
        catch (error) {
            handleApiError(error, res, 'Error al crear la suscripción');
        }
    }
    async getAll(req, res) {
        try {
            const filtro = FiltroSuscripcionDTO.parse(req.query);
            res.status(200).json(await suscripcionService.getAll(filtro));
        }
        catch (error) {
            handleApiError(error, res, 'Error al listar las suscripciones');
        }
    }
    async getById(req, res) {
        try {
            res.status(200).json(await suscripcionService.getById(req.params.id));
        }
        catch (error) {
            handleApiError(error, res, 'Error al obtener la suscripción');
        }
    }
    async actualizar(req, res) {
        try {
            const data = ActualizarSuscripcionDTO.parse(req.body);
            res.status(200).json(await suscripcionService.actualizar(req.params.id, data));
        }
        catch (error) {
            handleApiError(error, res, 'Error al actualizar la suscripción');
        }
    }
    async renovar(req, res) {
        try {
            const data = RenovarSuscripcionDTO.parse(req.body ?? {});
            res.status(200).json(await suscripcionService.renovar(req.params.id, data));
        }
        catch (error) {
            handleApiError(error, res, 'Error al renovar la suscripción');
        }
    }
    async cancelar(req, res) {
        try {
            res.status(200).json(await suscripcionService.cancelar(req.params.id));
        }
        catch (error) {
            handleApiError(error, res, 'Error al cancelar la suscripción');
        }
    }
    async eliminar(req, res) {
        try {
            await suscripcionService.eliminar(req.params.id);
            res.status(200).json({ message: 'Suscripción eliminada correctamente' });
        }
        catch (error) {
            handleApiError(error, res, 'Error al eliminar la suscripción');
        }
    }
}
