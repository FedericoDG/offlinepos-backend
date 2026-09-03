import { Response } from 'express';
import { ZodError } from 'zod';

/**
 * Traduccion de errores a HTTP para los modulos del panel.
 *
 * Repite a proposito la forma de respuesta que ya usan los controladores de
 * comercio y licencia (`message` + `errors[]` en las validaciones), para que
 * el panel tenga un solo formato de error que interpretar sin importar a que
 * endpoint le pego.
 */
export function handleApiError(error: any, res: Response, fallback = 'Error interno del servidor'): void {
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

  const statusCode = typeof error?.statusCode === 'number' ? error.statusCode : 500;
  res.status(statusCode).json({ message: error?.message || fallback });
}

/** Error con codigo HTTP explicito, para lanzar desde los services. */
export function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}
