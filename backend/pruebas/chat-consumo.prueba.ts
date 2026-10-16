/**
 * El detalle del consumo del chat resuelve el plan del comercio.
 *
 * El alta de comercios asigna el plan DIRECTO (Comercio.plan_id) y la
 * suscripcion es el modelo viejo. Este caso cubre un comercio con plan
 * directo y sin suscripciones: la tabla lo mostraba como "Sin plan" porque
 * el detalle solo miraba la suscripcion, y de paso caia al cupo por defecto
 * del entorno en vez del cupo real del plan.
 *
 * Se usa una base controlada minima en vez del arnes completo: solo se
 * ejercita lo que lee chatConsumo(), que es el mapeo de filas.
 */
import { validarLicenciaChat } from '../src/features/chat/chat.service';
import { EstadisticaService } from '../src/features/estadistica/estadistica.service';
import { igual, prueba, seccion } from './ayuda';

/** Base mínima: una fila de consumo con el comercio incrustado. */
function baseConComercio(comercio: unknown) {
  return {
    chatConsumo: {
      findMany: async () => [
        {
          licencia_id: 'lic-1',
          periodo: new Date().toISOString().slice(0, 7),
          mensajes: 7,
          prompt_tokens: BigInt(100),
          completion_tokens: BigInt(50),
          total_tokens: BigInt(150),
          cached_tokens: BigInt(0),
          modelo: 'qwen3.8-flash',
          licencia: { comercio },
        },
      ],
    },
  } as never;
}

export async function correr(): Promise<void> {
  seccion('Consumo del chat: el plan del comercio');

  {
    // El caso del alta nueva: plan directo, sin suscripciones.
    const servicio = new EstadisticaService(
      baseConComercio({
        nombre: 'Kiosco La Esquina',
        chat_mensajes_override: null,
        plan: { nombre: 'Pro', chat_mensajes_mes: 1500 },
        suscripciones: [],
      }) as never,
    );
    const r = await servicio.chatConsumo();
    igual('muestra el plan asignado directo', r.detalle[0]?.plan, 'Pro');
    igual('usa el cupo del plan, no el del entorno', r.detalle[0]?.mensajes_limite, 1500);
  }

  {
    // No puede romperse el caso viejo: sin plan directo, con suscripción.
    const servicio = new EstadisticaService(
      baseConComercio({
        nombre: 'Almacén Viejo',
        chat_mensajes_override: null,
        plan: null,
        suscripciones: [{ plan: { nombre: 'Básico', chat_mensajes_mes: 400 } }],
      }) as never,
    );
    const r = await servicio.chatConsumo();
    igual('un comercio con suscripción sigue mostrando su plan', r.detalle[0]?.plan, 'Básico');
    igual('y sigue usando su cupo', r.detalle[0]?.mensajes_limite, 400);
  }

  {
    // El override del comercio gana sobre cualquier plan.
    const servicio = new EstadisticaService(
      baseConComercio({
        nombre: 'Con Override',
        chat_mensajes_override: 99,
        plan: { nombre: 'Pro', chat_mensajes_mes: 1500 },
        suscripciones: [],
      }) as never,
    );
    const r = await servicio.chatConsumo();
    igual('el override del comercio tiene prioridad', r.detalle[0]?.mensajes_limite, 99);
  }

  seccion('Bloqueo por licencia (la puerta de Binny y de los precios)');

  /** Base minima de la puerta: licencia + activacion. */
  const basePuerta = (estado: string, hayActivacion = true) =>
    ({
      licencia: {
        findUnique: async () => ({ id: 'lic-1', estado, comercio_id: 'com-1' }),
        findMany: async () => [],
      },
      activacion: { findUnique: async () => (hayActivacion ? { id: 'act-1' } : null) },
    }) as never;

  const rechazo = async (promesa: () => Promise<unknown>): Promise<string | null> => {
    try {
      await promesa();
      return null;
    } catch (error) {
      return (error as { message?: string }).message ?? String(error);
    }
  };

  {
    const r = await rechazo(() => validarLicenciaChat('clave', 'instalacion', basePuerta('suspendida')));
    igual('una licencia suspendida bloquea', r, 'La licencia no esta activa');
  }

  {
    const r = await rechazo(() => validarLicenciaChat('clave', 'instalacion', basePuerta('activa')));
    prueba('una licencia activa y con activacion pasa', r === null, r);
  }

  {
    const r = await rechazo(() => validarLicenciaChat('clave', 'instalacion', basePuerta('activa', false)));
    igual('una instalacion sin activacion valida tambien bloquea', r, 'Esta instalacion no tiene una activacion valida');
  }

  {
    const r = await rechazo(() =>
      validarLicenciaChat('clave', 'instalacion', { licencia: { findUnique: async () => null, findMany: async () => [] } } as never),
    );
    igual('una clave que no existe da 404', r, 'Licencia no encontrada');
  }
}
