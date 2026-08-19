import { ComercioService } from './comercio.service';
import { CreateComercioConLicenciaDTO, UpdateComercioDTO } from './comercio.dtos';
import { ZodError } from 'zod';
const comercioService = new ComercioService();
export class ComercioController {
    async create(req, res) {
        try {
            const validatedData = CreateComercioConLicenciaDTO.parse(req.body);
            const result = await comercioService.createConLicencia(validatedData);
            res.status(201).json(result);
        }
        catch (error) {
            this.handleError(error, res);
        }
    }
    async getAll(_req, res) {
        try {
            const comercios = await comercioService.getAll();
            res.status(200).json(comercios);
        }
        catch (error) {
            this.handleError(error, res);
        }
    }
    async getById(req, res) {
        try {
            const id = req.params.id;
            const comercio = await comercioService.getById(id);
            res.status(200).json(comercio);
        }
        catch (error) {
            this.handleError(error, res);
        }
    }
    async update(req, res) {
        try {
            const id = req.params.id;
            const validatedData = UpdateComercioDTO.parse(req.body);
            const updated = await comercioService.update(id, validatedData);
            res.status(200).json(updated);
        }
        catch (error) {
            this.handleError(error, res);
        }
    }
    async delete(req, res) {
        try {
            const id = req.params.id;
            await comercioService.delete(id);
            res.status(200).json({ message: 'Comercio y sus licencias eliminados correctamente' });
        }
        catch (error) {
            this.handleError(error, res);
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
        if (error.message === 'Comercio no encontrado') {
            res.status(404).json({ message: error.message });
            return;
        }
        res.status(500).json({ message: error.message || 'Error interno del servidor' });
    }
}
