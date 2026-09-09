import { EstadisticaService } from './estadistica.service';
import { RangoDiasDTO, RangoMesesDTO } from './estadistica.dtos';
import { handleApiError } from '../../utils/api-error';
const estadisticaService = new EstadisticaService();
export class EstadisticaController {
    async resumen(_req, res) {
        try {
            res.status(200).json(await estadisticaService.resumen());
        }
        catch (error) {
            handleApiError(error, res, 'Error al calcular el resumen');
        }
    }
    async ingresosMensuales(req, res) {
        try {
            const { meses } = RangoMesesDTO.parse(req.query);
            res.status(200).json(await estadisticaService.ingresosMensuales(meses));
        }
        catch (error) {
            handleApiError(error, res, 'Error al calcular los ingresos mensuales');
        }
    }
    async proximosVencimientos(req, res) {
        try {
            const { dias } = RangoDiasDTO.parse(req.query);
            res.status(200).json(await estadisticaService.proximosVencimientos(dias));
        }
        catch (error) {
            handleApiError(error, res, 'Error al obtener los próximos vencimientos');
        }
    }
    async ingresosPorPlan(req, res) {
        try {
            const { meses } = RangoMesesDTO.parse(req.query);
            res.status(200).json(await estadisticaService.ingresosPorPlan(meses));
        }
        catch (error) {
            handleApiError(error, res, 'Error al calcular los ingresos por plan');
        }
    }
    async chatConsumo(req, res) {
        try {
            const periodo = req.query.periodo;
            res.status(200).json(await estadisticaService.chatConsumo(periodo));
        }
        catch (error) {
            handleApiError(error, res, 'Error al obtener el consumo del chat');
        }
    }
}
