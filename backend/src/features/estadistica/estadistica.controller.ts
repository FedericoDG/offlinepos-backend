import { Request, Response } from 'express';
import { EstadisticaService } from './estadistica.service';
import { RangoDiasDTO, RangoMesesDTO } from './estadistica.dtos';
import { handleApiError } from '../../utils/api-error';

const estadisticaService = new EstadisticaService();

export class EstadisticaController {
  async resumen(_req: Request, res: Response): Promise<void> {
    try {
      res.status(200).json(await estadisticaService.resumen());
    } catch (error: any) {
      handleApiError(error, res, 'Error al calcular el resumen');
    }
  }

  async ingresosMensuales(req: Request, res: Response): Promise<void> {
    try {
      const { meses } = RangoMesesDTO.parse(req.query);
      res.status(200).json(await estadisticaService.ingresosMensuales(meses));
    } catch (error: any) {
      handleApiError(error, res, 'Error al calcular los ingresos mensuales');
    }
  }

  async proximosVencimientos(req: Request, res: Response): Promise<void> {
    try {
      const { dias } = RangoDiasDTO.parse(req.query);
      res.status(200).json(await estadisticaService.proximosVencimientos(dias));
    } catch (error: any) {
      handleApiError(error, res, 'Error al obtener los próximos vencimientos');
    }
  }

  async ingresosPorPlan(req: Request, res: Response): Promise<void> {
    try {
      const { meses } = RangoMesesDTO.parse(req.query);
      res.status(200).json(await estadisticaService.ingresosPorPlan(meses));
    } catch (error: any) {
      handleApiError(error, res, 'Error al calcular los ingresos por plan');
    }
  }
}
