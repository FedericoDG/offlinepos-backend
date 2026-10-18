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
    // Log sin valores (solo path/código/mensaje) para diagnosticar 400s
    // sin filtrar datos sensibles como claves de licencia.
    console.warn(
      '[API] validación fallida',
      JSON.stringify(
        error.issues.map((issue) => ({
          field: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      ),
    );
    res.status(400).json({
      message: 'Error de validación en los datos enviados',
      errors: error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  // Un `statusCode` marca un error intencional (los que arma httpError): su
  // mensaje es para el cliente. Sin `statusCode` es un fallo inesperado
  // (Prisma caido, red, un bug): se registra del lado del servidor y al cliente
  // solo le llega el fallback, sin detalles internos de la query ni de la
  // conexion.
  if (typeof error?.statusCode === 'number') {
    res.status(error.statusCode).json({ message: error.message || fallback });
    return;
  }

  console.error('[API] error inesperado', error);
  res.status(500).json({ message: fallback });
}

/** Error con codigo HTTP explicito, para lanzar desde los services. */
export function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}
