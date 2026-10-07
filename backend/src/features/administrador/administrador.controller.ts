import { Request, Response } from 'express';
import { AdministradorService } from './administrador.service';
import {
  ActualizarAdministradorDTO,
  CambiarActivoDTO,
  CrearAdministradorDTO,
  LoginDTO,
  ResetPasswordDTO,
} from './administrador.dtos';
import { handleApiError } from '../../utils/api-error';
import { ZodError } from 'zod';

const administradorService = new AdministradorService();

export class AdministradorController {
  async login(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = LoginDTO.parse(req.body);
      const result = await administradorService.login(validatedData);
      res.status(200).json(result);
    } catch (error: any) {
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

      // 401 por defecto (credenciales), 403 cuando el usuario está desactivado.
      res.status(error.statusCode ?? 401).json({ message: error.message || 'Error al iniciar sesión' });
    }
  }

  async getAll(_req: Request, res: Response): Promise<void> {
    try {
      res.status(200).json(await administradorService.listar());
    } catch (error: any) {
      handleApiError(error, res, 'Error al listar los administradores');
    }
  }

  async crear(req: Request, res: Response): Promise<void> {
    try {
      const data = CrearAdministradorDTO.parse(req.body);
      res.status(201).json(await administradorService.crear(data));
    } catch (error: any) {
      handleApiError(error, res, 'Error al crear el administrador');
    }
  }

  async actualizar(req: Request, res: Response): Promise<void> {
    try {
      const data = ActualizarAdministradorDTO.parse(req.body);
      res.status(200).json(
        await administradorService.actualizar(req.params.id as string, data, req.user?.id ?? '')
      );
    } catch (error: any) {
      handleApiError(error, res, 'Error al actualizar el administrador');
    }
  }

  async eliminar(req: Request, res: Response): Promise<void> {
    try {
      await administradorService.eliminar(req.params.id as string, req.user?.id ?? '');
      res.status(200).json({ message: 'Administrador eliminado correctamente' });
    } catch (error: any) {
      handleApiError(error, res, 'Error al eliminar el administrador');
    }
  }

  async resetPassword(req: Request, res: Response): Promise<void> {
    try {
      const data = ResetPasswordDTO.parse(req.body);
      res.status(200).json(await administradorService.resetPassword(req.params.id as string, data.password));
    } catch (error: any) {
      handleApiError(error, res, 'Error al resetear la contraseña');
    }
  }

  async cambiarActivo(req: Request, res: Response): Promise<void> {
    try {
      const { activo } = CambiarActivoDTO.parse(req.body);
      res.status(200).json(
        await administradorService.cambiarActivo(req.params.id as string, activo, req.user?.id ?? '')
      );
    } catch (error: any) {
      handleApiError(error, res, 'Error al cambiar el estado del administrador');
    }
  }
}
