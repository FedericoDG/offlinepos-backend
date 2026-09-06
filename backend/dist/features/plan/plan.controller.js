import { PlanService } from './plan.service';
import { ActualizarPlanDTO, CrearPlanDTO } from './plan.dtos';
import { handleApiError } from '../../utils/api-error';
const planService = new PlanService();
export class PlanController {
    async crear(req, res) {
        try {
            const data = CrearPlanDTO.parse(req.body);
            res.status(201).json(await planService.crear(data));
        }
        catch (error) {
            handleApiError(error, res, 'Error al crear el plan');
        }
    }
    async getAll(req, res) {
        try {
            const soloActivos = req.query.activos === 'true';
            res.status(200).json(await planService.getAll(soloActivos));
        }
        catch (error) {
            handleApiError(error, res, 'Error al listar los planes');
        }
    }
    async getById(req, res) {
        try {
            res.status(200).json(await planService.getById(req.params.id));
        }
        catch (error) {
            handleApiError(error, res, 'Error al obtener el plan');
        }
    }
    async actualizar(req, res) {
        try {
            const data = ActualizarPlanDTO.parse(req.body);
            res.status(200).json(await planService.actualizar(req.params.id, data));
        }
        catch (error) {
            handleApiError(error, res, 'Error al actualizar el plan');
        }
    }
    async desactivar(req, res) {
        try {
            res.status(200).json(await planService.desactivar(req.params.id));
        }
        catch (error) {
            handleApiError(error, res, 'Error al desactivar el plan');
        }
    }
    async eliminar(req, res) {
        try {
            await planService.eliminar(req.params.id);
            res.status(200).json({ message: 'Plan eliminado correctamente' });
        }
        catch (error) {
            handleApiError(error, res, 'Error al eliminar el plan');
        }
    }
}
