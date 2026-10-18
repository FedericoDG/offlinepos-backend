/**
 * Serializacion de errores HTTP.
 *
 * La regla: solo los errores intencionales —los que traen `statusCode`, armados
 * con `httpError`— muestran su mensaje al cliente. Un error inesperado (Prisma
 * caido, red, un bug) se registra del lado del servidor y al cliente solo le
 * llega el mensaje generico, sin detalles internos de la query ni del motor.
 */
import bcrypt from 'bcrypt';
import { ZodError } from 'zod';
import { AdministradorService } from '../src/features/administrador/administrador.service';
import {
  llamarLLM,
  MENSAJES_PROVEEDOR_SEGUROS,
  mensajeSeguroDeError,
} from '../src/features/chat/chat.llm';
import { handleApiError, httpError } from '../src/utils/api-error';
import { igual, prueba, seccion } from './ayuda';

/** Response falsa: alcanza con capturar el status y el cuerpo. */
function resFalsa(): { res: any; salida: { status: number | null; cuerpo: any } } {
  const salida: { status: number | null; cuerpo: any } = { status: null, cuerpo: null };
  const res: any = {
    status(codigo: number) {
      salida.status = codigo;
      return res;
    },
    json(cuerpo: any) {
      salida.cuerpo = cuerpo;
      return res;
    },
  };
  return { res, salida };
}

export async function correr(): Promise<void> {
  // ------------------------------------------------- errores inesperados
  seccion('Un error inesperado no filtra su mensaje al cliente');

  {
    const { res, salida } = resFalsa();
    const crudo =
      "Can't reach database server at ep-cool-1234.us-east-2.aws.neon.tech:5432 " +
      '(prisma.administrador.findUnique)';
    handleApiError(new Error(crudo), res, 'Error interno del servidor');

    igual('responde 500', salida.status, 500);
    igual('mensaje generico', salida.cuerpo?.message, 'Error interno del servidor');
    prueba(
      'no viaja el mensaje crudo',
      !JSON.stringify(salida.cuerpo).includes('neon.tech'),
      salida.cuerpo,
    );
  }

  // ------------------------------------------------- errores intencionales
  seccion('Un error intencional conserva su status y su mensaje');

  {
    const { res, salida } = resFalsa();
    handleApiError(httpError('Credenciales inválidas', 401), res, 'Error al iniciar sesión');
    igual('responde 401', salida.status, 401);
    igual('mensaje para el cliente', salida.cuerpo?.message, 'Credenciales inválidas');
  }

  {
    const { res, salida } = resFalsa();
    handleApiError(httpError('Usuario desactivado', 403), res, 'Error al iniciar sesión');
    igual('responde 403', salida.status, 403);
    igual('mensaje para el cliente', salida.cuerpo?.message, 'Usuario desactivado');
  }

  // ------------------------------------------------- validaciones de Zod
  seccion('Una validacion Zod sigue devolviendo 400 con sus campos');

  {
    const { res, salida } = resFalsa();
    const zod = new ZodError([
      { code: 'custom', path: ['email'], message: 'Ese email no tiene formato válido' } as any,
    ]);
    handleApiError(zod, res, 'Error interno del servidor');

    igual('responde 400', salida.status, 400);
    igual('mensaje de validacion', salida.cuerpo?.message, 'Error de validación en los datos enviados');
    igual('campo del error', salida.cuerpo?.errors, [
      { field: 'email', message: 'Ese email no tiene formato válido' },
    ]);
  }

  // ------------------------------------------------- el login del panel
  seccion('El login marca sus errores como intencionales');

  {
    // El service solo usa administrador.findUnique en este camino.
    const sinNadie = { administrador: { findUnique: async () => null } } as any;
    let capturado: any = null;
    try {
      await new AdministradorService(sinNadie).login({
        email: 'nadie@ejemplo.com',
        password: 'loquesea',
      } as any);
    } catch (e) {
      capturado = e;
    }

    igual('credenciales incorrectas traen statusCode', capturado?.statusCode, 401);
    igual('y el mensaje es el de credenciales', capturado?.message, 'Credenciales inválidas');
  }

  {
    // Con la contrasena correcta, pero el usuario dado de baja.
    const hash = await bcrypt.hash('clave-correcta', 4);
    const dadoDeBaja = {
      administrador: {
        findUnique: async () => ({
          id: 'adm-1',
          email: 'a@b.com',
          password: hash,
          activo: false,
          rol: 'ADMINISTRADOR',
        }),
      },
    } as any;
    let capturado: any = null;
    try {
      await new AdministradorService(dadoDeBaja).login({
        email: 'a@b.com',
        password: 'clave-correcta',
      } as any);
    } catch (e) {
      capturado = e;
    }

    igual('usuario desactivado trae statusCode', capturado?.statusCode, 403);
    igual('y su mensaje', capturado?.message, 'Usuario desactivado');
  }

  {
    // El caso que motivo el arreglo: la base no responde durante el login.
    const caida = {
      administrador: {
        findUnique: async () => {
          throw new Error(
            "Can't reach database server at ep-cool-1234.us-east-2.aws.neon.tech:5432",
          );
        },
      },
    } as any;
    let capturado: any = null;
    try {
      await new AdministradorService(caida).login({
        email: 'alguien@ejemplo.com',
        password: 'loquesea',
      } as any);
    } catch (e) {
      capturado = e;
    }

    prueba('un fallo de base no se disfraza de error intencional', capturado?.statusCode === undefined, capturado?.statusCode);
  }

  // --------------------------------------- errores del proveedor de IA
  seccion('Un error de proveedor declarado seguro sobrevive a handleApiError');

  {
    const fetchOriginal = globalThis.fetch;
    try {
      // El proveedor contesta 429: es el caso realista (cuota o rate limit).
      globalThis.fetch = (async () =>
        new Response('el proveedor exploto', { status: 429 })) as typeof fetch;

      let capturado: any = null;
      try {
        await llamarLLM([{ role: 'user', content: 'hola' }]);
      } catch (e) {
        capturado = e;
      }

      igual('el error trae statusCode', capturado?.statusCode, 500);
      igual(
        'el mensaje es el del proveedor',
        capturado?.message,
        'Error del proveedor LLM (código 429)',
      );
      prueba(
        'el mensaje matchea la lista declarada segura en chat.llm.ts',
        MENSAJES_PROVEEDOR_SEGUROS.some((re) => re.test(capturado?.message ?? '')),
        capturado?.message,
      );
      igual(
        'el filtro del controlador de streaming tambien lo deja pasar',
        mensajeSeguroDeError(capturado),
        'Error del proveedor LLM (código 429)',
      );

      const { res, salida } = resFalsa();
      handleApiError(capturado, res, 'Error interno del servidor');
      igual('sale 500', salida.status, 500);
      igual(
        'y NO se vuelve generico en los endpoints no-stream',
        salida.cuerpo?.message,
        'Error del proveedor LLM (código 429)',
      );
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }

  {
    const { res, salida } = resFalsa();
    const interno = new Error(
      "Invalid `prisma.x()` invocation: Can't reach database server at 127.0.0.1:5432",
    );
    handleApiError(interno, res, 'Error interno del servidor');
    igual('un error interno sigue saliendo 500', salida.status, 500);
    igual('con mensaje generico', salida.cuerpo?.message, 'Error interno del servidor');
    igual(
      'y el filtro del controlador tampoco lo deja pasar',
      mensajeSeguroDeError(interno),
      null,
    );
  }
}
