import { Request, Response } from 'express';
import { ComercioService } from './comercio.service';
import {
  CreateComercioConLicenciaDTO,
  RegistrarPagoDirectoDTO,
  UpdateComercioDTO,
} from './comercio.dtos';
import { ZodError } from 'zod';
import { handleApiError } from '../../utils/api-error';

const comercioService = new ComercioService();

export class ComercioController {
  async create(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = CreateComercioConLicenciaDTO.parse(req.body);
      const result = await comercioService.createConLicencia(validatedData);
      res.status(201).json(result);
    } catch (error: any) {
      // Los httpError del service (404 del plan, 409 del cupo o de una clave ya
      // asignada) viajan con el codigo HTTP correcto.
      handleApiError(error, res, 'Error al crear el comercio');
    }
  }

  async getAll(_req: Request, res: Response): Promise<void> {
    try {
      const comercios = await comercioService.getAll();
      res.status(200).json(comercios);
    } catch (error: any) {
      this.handleError(error, res);
    }
  }

  async getById(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const comercio = await comercioService.getById(id);
      res.status(200).json(comercio);
    } catch (error: any) {
      this.handleError(error, res);
    }
  }

  async update(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const validatedData = UpdateComercioDTO.parse(req.body);
      const updated = await comercioService.update(id, validatedData);
      res.status(200).json(updated);
    } catch (error: any) {
      this.handleError(error, res);
    }
  }

  /** GET /api/comercios/:id/detalle — todo lo de la pantalla de detalle en una vuelta. */
  async getDetalle(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const detalle = await comercioService.getDetalle(id);
      res.status(200).json(detalle);
    } catch (error: any) {
      handleApiError(error, res, 'Error al obtener el detalle del comercio');
    }
  }

  /** POST /api/comercios/:id/pagos — pago directo, sin Suscripcion. */
  async registrarPago(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const data = RegistrarPagoDirectoDTO.parse(req.body);
      const pago = await comercioService.registrarPago(id, data);
      res.status(201).json(pago);
    } catch (error: any) {
      handleApiError(error, res, 'Error al registrar el pago');
    }
  }

  async delete(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      await comercioService.delete(id);
      res.status(200).json({ message: 'Comercio y sus licencias eliminados correctamente' });
    } catch (error: any) {
      this.handleError(error, res);
    }
  }

  private handleError(error: any, res: Response): void {
    if (error instanceof ZodError) {
      res.status(400).json({
        message: 'Error de validación en los datos enviados',
        errors: error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }

    if (error.message === 'Comercio no encontrado') {
      res.status(404).json({ message: error.message });
      return;
    }

    res.status(500).json({ message: error.message || 'Error interno del servidor' });
  }
}
