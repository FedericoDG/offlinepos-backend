import { Request, Response } from 'express';
import { SuscripcionService } from './suscripcion.service';
import {
  ActualizarSuscripcionDTO,
  CrearSuscripcionDTO,
  FiltroSuscripcionDTO,
  RenovarSuscripcionDTO,
} from './suscripcion.dtos';
import { handleApiError } from '../../utils/api-error';

const suscripcionService = new SuscripcionService();

export class SuscripcionController {
  async crear(req: Request, res: Response): Promise<void> {
    try {
      const data = CrearSuscripcionDTO.parse(req.body);
      res.status(201).json(await suscripcionService.crear(data));
    } catch (error: any) {
      handleApiError(error, res, 'Error al crear la suscripción');
    }
  }

  async getAll(req: Request, res: Response): Promise<void> {
    try {
      const filtro = FiltroSuscripcionDTO.parse(req.query);
      res.status(200).json(await suscripcionService.getAll(filtro));
    } catch (error: any) {
      handleApiError(error, res, 'Error al listar las suscripciones');
    }
  }

  async getById(req: Request, res: Response): Promise<void> {
    try {
      res.status(200).json(await suscripcionService.getById(req.params.id as string));
    } catch (error: any) {
      handleApiError(error, res, 'Error al obtener la suscripción');
    }
  }

  async actualizar(req: Request, res: Response): Promise<void> {
    try {
      const data = ActualizarSuscripcionDTO.parse(req.body);
      res.status(200).json(await suscripcionService.actualizar(req.params.id as string, data));
    } catch (error: any) {
      handleApiError(error, res, 'Error al actualizar la suscripción');
    }
  }

  async renovar(req: Request, res: Response): Promise<void> {
    try {
      const data = RenovarSuscripcionDTO.parse(req.body ?? {});
      res.status(200).json(await suscripcionService.renovar(req.params.id as string, data));
    } catch (error: any) {
      handleApiError(error, res, 'Error al renovar la suscripción');
    }
  }

  async cancelar(req: Request, res: Response): Promise<void> {
    try {
      res.status(200).json(await suscripcionService.cancelar(req.params.id as string));
    } catch (error: any) {
      handleApiError(error, res, 'Error al cancelar la suscripción');
    }
  }

  async eliminar(req: Request, res: Response): Promise<void> {
    try {
      await suscripcionService.eliminar(req.params.id as string);
      res.status(200).json({ message: 'Suscripción eliminada correctamente' });
    } catch (error: any) {
      handleApiError(error, res, 'Error al eliminar la suscripción');
    }
  }
}
