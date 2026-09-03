import { Request, Response } from 'express';
import { PlanService } from './plan.service';
import { ActualizarPlanDTO, CrearPlanDTO } from './plan.dtos';
import { handleApiError } from '../../utils/api-error';

const planService = new PlanService();

export class PlanController {
  async crear(req: Request, res: Response): Promise<void> {
    try {
      const data = CrearPlanDTO.parse(req.body);
      res.status(201).json(await planService.crear(data));
    } catch (error: any) {
      handleApiError(error, res, 'Error al crear el plan');
    }
  }

  async getAll(req: Request, res: Response): Promise<void> {
    try {
      const soloActivos = req.query.activos === 'true';
      res.status(200).json(await planService.getAll(soloActivos));
    } catch (error: any) {
      handleApiError(error, res, 'Error al listar los planes');
    }
  }

  async getById(req: Request, res: Response): Promise<void> {
    try {
      res.status(200).json(await planService.getById(req.params.id as string));
    } catch (error: any) {
      handleApiError(error, res, 'Error al obtener el plan');
    }
  }

  async actualizar(req: Request, res: Response): Promise<void> {
    try {
      const data = ActualizarPlanDTO.parse(req.body);
      res.status(200).json(await planService.actualizar(req.params.id as string, data));
    } catch (error: any) {
      handleApiError(error, res, 'Error al actualizar el plan');
    }
  }

  async desactivar(req: Request, res: Response): Promise<void> {
    try {
      res.status(200).json(await planService.desactivar(req.params.id as string));
    } catch (error: any) {
      handleApiError(error, res, 'Error al desactivar el plan');
    }
  }

  async eliminar(req: Request, res: Response): Promise<void> {
    try {
      await planService.eliminar(req.params.id as string);
      res.status(200).json({ message: 'Plan eliminado correctamente' });
    } catch (error: any) {
      handleApiError(error, res, 'Error al eliminar el plan');
    }
  }
}
