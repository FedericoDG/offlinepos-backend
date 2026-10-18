import { Request, Response } from 'express';
import { LicenciaService } from './licencia.service';
import { ActivarLicenciaDTO, CrearLicenciaDTO } from './licencia.dtos';
import { handleApiError } from '../../utils/api-error';

const licenciaService = new LicenciaService();

export class LicenciaController {
  async crear(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = CrearLicenciaDTO.parse(req.body);
      const result = await licenciaService.crear(validatedData);
      res.status(201).json(result);
    } catch (error: any) {
      handleApiError(error, res, 'Error al emitir la licencia');
    }
  }

  async activar(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = ActivarLicenciaDTO.parse(req.body);
      const result = await licenciaService.activar(validatedData);
      res.status(200).json(result);
    } catch (error: any) {
      handleApiError(error, res, 'Error al procesar la activación de licencia');
    }
  }
}
