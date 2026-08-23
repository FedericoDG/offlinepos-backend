import { LicenciaService } from './licencia.service';
import { ActivarLicenciaDTO, CrearLicenciaDTO } from './licencia.dtos';
import { ZodError } from 'zod';
const licenciaService = new LicenciaService();
export class LicenciaController {
    async crear(req, res) {
        try {
            const validatedData = CrearLicenciaDTO.parse(req.body);
            const result = await licenciaService.crear(validatedData);
            res.status(201).json(result);
        }
        catch (error) {
            this.handleError(error, res);
        }
    }
    async activar(req, res) {
        try {
            const validatedData = ActivarLicenciaDTO.parse(req.body);
            const result = await licenciaService.activar(validatedData);
            res.status(200).json(result);
        }
        catch (error) {
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
            const statusCode = error.statusCode || 500;
            res.status(statusCode).json({
                message: error.message || 'Error al procesar la activación de licencia',
            });
        }
    }
    handleError(error, res) {
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
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({
            message: error.message || 'Error al emitir la licencia',
        });
    }
}
