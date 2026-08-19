import { AdministradorService } from './administrador.service';
import { LoginDTO } from './administrador.dtos';
import { ZodError } from 'zod';
const administradorService = new AdministradorService();
export class AdministradorController {
    async login(req, res) {
        try {
            const validatedData = LoginDTO.parse(req.body);
            const result = await administradorService.login(validatedData);
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
            res.status(401).json({ message: error.message || 'Error al iniciar sesión' });
        }
    }
}
