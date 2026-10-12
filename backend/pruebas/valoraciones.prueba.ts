/**
 * Valoraciones de Binny: escritura por signo (👍/👎), lectura para el panel y
 * validación del contrato del endpoint. Ejercita los services REALES
 * (ChatService y EstadisticaService) contra la base falsa en memoria y los DTO
 * con Zod, sin Postgres.
 *
 * Diseño nuevo: las 👍 NO guardan fila ni texto, solo suman al contador
 * agregado por comercio/período; las 👎 guardan la fila con el caso concreto y
 * suman al contador.
 */
import { EstadisticaService } from '../src/features/estadistica/estadistica.service';
import { ValoracionesFiltroDTO } from '../src/features/estadistica/estadistica.dtos';
import { ValoracionDTO } from '../src/features/chat/chat.dtos';
import { ChatService } from '../src/features/chat/chat.service';
import { hmacBusqueda } from '../src/utils/encryption';
import { crearBaseFalsa, falla, igual, prueba, seccion, vacia, type Datos } from './ayuda';

const CLAVE = 'clave-de-prueba';
const INSTALACION = 'pc-1';

function mesActual(): string {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
}

/** Un dia del mes en curso, a las 12 para no rozar los bordes del mes. */
function esteMes(dia: number): Date {
  const h = new Date();
  return new Date(h.getFullYear(), h.getMonth(), dia, 12, 0, 0);
}

/** Comercios de base para los casos. */
function conComercios(): Datos {
  const d = vacia();
  d.comercios.push({ id: 'c1', nombre: 'Almacén San Martín', createdAt: new Date(), updatedAt: new Date() });
  d.comercios.push({ id: 'c2', nombre: 'Kiosco La Esquina', createdAt: new Date(), updatedAt: new Date() });
  return d;
}

/**
 * Comercios + licencia activa + activación, para poder llamar a
 * `ChatService.valorar` (que valida la licencia antes de guardar).
 */
function conLicencia(comercioId: string | null = 'c1'): Datos {
  const d = conComercios();
  d.licencias.push({
    id: 'lic-1',
    comercio_id: comercioId,
    clave_hash: 'hash-irrelevante',
    clave_busqueda: hmacBusqueda(CLAVE),
    estado: 'activa',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  d.activaciones.push({
    id: 'act-1',
    licencia_id: 'lic-1',
    instalacion_id: INSTALACION,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return d;
}

/** Llama al service real como lo haría el endpoint. */
function valorar(db: unknown, valoracion: number, extra: Record<string, unknown> = {}) {
  return new ChatService(db as any).valorar({
    clave: CLAVE,
    instalacion_id: INSTALACION,
    valoracion,
    pregunta: 'pregunta',
    respuesta: 'respuesta',
    ...extra,
  });
}

function agregarValoracion(
  d: Datos,
  id: string,
  comercioId: string | null,
  valoracion: number,
  cuando: Date,
  fuente: string | null = null,
) {
  d.valoraciones.push({
    id,
    licencia_id: 'lic-1',
    comercio_id: comercioId,
    valoracion,
    pregunta: `pregunta ${id}`,
    respuesta: `respuesta ${id}`,
    fuente,
    creado_en: cuando,
    createdAt: cuando,
  });
}

function agregarResumen(
  d: Datos,
  id: string,
  comercioId: string,
  periodo: string,
  positivas: number,
  negativas: number,
) {
  d.valoracionesResumen.push({
    id,
    comercio_id: comercioId,
    periodo,
    positivas,
    negativas,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function correr(): Promise<void> {
  seccion('Valoraciones: escritura por signo (ChatService.valorar)');

  {
    // 👍: no se guarda fila ni texto; solo suma al contador.
    const d = conLicencia();
    const { db } = crearBaseFalsa(d);
    await valorar(db, 1);

    igual('una 👍 no guarda fila en chatValoracion', d.valoraciones.length, 0);
    igual('crea una fila de resumen', d.valoracionesResumen.length, 1);
    igual('con positivas = 1', d.valoracionesResumen[0].positivas, 1);
    igual('y sin negativas', Number(d.valoracionesResumen[0].negativas ?? 0), 0);
    igual('atribuida al comercio', d.valoracionesResumen[0].comercio_id, 'c1');
    igual('en el período actual', d.valoracionesResumen[0].periodo, mesActual());
  }

  {
    // 👎: guarda la fila CON el texto y suma al contador.
    const d = conLicencia();
    const { db } = crearBaseFalsa(d);
    await valorar(db, -1, {
      pregunta: '¿Cuánto vendí hoy?',
      respuesta: 'No tengo esa información.',
      fuente: 'agente',
    });

    igual('una 👎 guarda una fila', d.valoraciones.length, 1);
    igual('con la pregunta completa', d.valoraciones[0].pregunta, '¿Cuánto vendí hoy?');
    igual('con la respuesta completa', d.valoraciones[0].respuesta, 'No tengo esa información.');
    igual('con la fuente', d.valoraciones[0].fuente, 'agente');
    igual('con el signo', d.valoraciones[0].valoracion, -1);
    igual('suma 1 a negativas', d.valoracionesResumen[0].negativas, 1);
    igual('sin tocar positivas', Number(d.valoracionesResumen[0].positivas ?? 0), 0);
  }

  {
    // Dos 👍 en el mismo mes: UNA sola fila de resumen con positivas = 2.
    const d = conLicencia();
    const { db } = crearBaseFalsa(d);
    await valorar(db, 1);
    await valorar(db, 1);

    igual('dos 👍 no dejan ninguna fila', d.valoraciones.length, 0);
    igual('hay una sola fila de resumen', d.valoracionesResumen.length, 1);
    igual('con positivas = 2', d.valoracionesResumen[0].positivas, 2);
  }

  {
    // 👍 y 👎 mezcladas: una fila de resumen con ambos contadores.
    const d = conLicencia();
    const { db } = crearBaseFalsa(d);
    await valorar(db, 1);
    await valorar(db, -1);
    await valorar(db, 1);

    igual('el resumen es una sola fila', d.valoracionesResumen.length, 1);
    igual('positivas = 2', d.valoracionesResumen[0].positivas, 2);
    igual('negativas = 1', d.valoracionesResumen[0].negativas, 1);
    igual('y una sola fila de detalle', d.valoraciones.length, 1);
  }

  {
    // Clave libre (sin comercio): no se puede atribuir.
    const d = conLicencia(null);
    const { db } = crearBaseFalsa(d);
    await valorar(db, 1);

    igual('una 👍 sin comercio no crea resumen', d.valoracionesResumen.length, 0);
    igual('ni fila de detalle', d.valoraciones.length, 0);

    await valorar(db, -1, { respuesta: 'caso malo' });
    igual('una 👎 sin comercio sí guarda la fila', d.valoraciones.length, 1);
    igual('con el texto', d.valoraciones[0].respuesta, 'caso malo');
    igual('pero no toca ningún contador', d.valoracionesResumen.length, 0);
  }

  seccion('Valoraciones: lectura para el panel (EstadisticaService.valoraciones)');

  {
    const d = conComercios();
    agregarResumen(d, 'r1', 'c1', mesActual(), 3, 1);
    agregarResumen(d, 'r2', 'c2', mesActual(), 2, 1);
    // Un período viejo que no debe entrar al filtrar por el mes actual.
    agregarResumen(d, 'r-viejo', 'c1', '2020-01', 9, 9);
    // El detalle solo tiene las negativas (las únicas con texto).
    agregarValoracion(d, 'v1', 'c1', -1, esteMes(2), 'agente');
    agregarValoracion(d, 'v2', 'c2', -1, esteMes(3));
    agregarValoracion(d, 'vieja', 'c1', -1, new Date(2020, 0, 15, 12, 0, 0));
    // Una 👍 histórica (guardada antes del diseño nuevo) no debe aparecer en el
    // detalle: el panel solo revisa casos malos.
    agregarValoracion(d, 'positiva-vieja', 'c1', 1, esteMes(4));

    const { db } = crearBaseFalsa(d);
    const r = await new EstadisticaService(db).valoraciones({ periodo: mesActual() });

    igual('el total es positivas + negativas', r.resumen.total, 7);
    igual('suma las positivas del contador', r.resumen.positivas, 5);
    igual('suma las negativas del contador', r.resumen.negativas, 2);
    igual('el detalle del mes trae dos negativas', r.detalle.length, 2);
    prueba('el detalle es solo negativas', r.detalle.every((x) => x.valoracion < 0), r.detalle.map((x) => x.valoracion));
    igual('ordenado por fecha descendente', r.detalle[0].id, 'v2');
    igual('resuelve el nombre del comercio', r.detalle[0].comercio, 'Kiosco La Esquina');
    igual('pasa la fuente cuando viene', r.detalle.find((x) => x.id === 'v1')?.fuente, 'agente');
    igual('la fuente vacía queda en null', r.detalle.find((x) => x.id === 'v2')?.fuente, null);

    // Sin período: el contador suma todos los meses.
    const todo = await new EstadisticaService(db).valoraciones({});
    igual('sin período suma todos los contadores', todo.resumen.total, 25);
    igual('y trae todo el detalle', todo.detalle.length, 3);
  }

  {
    // Un período sin valoraciones no rompe: todo en cero y detalle vacío.
    const { db } = crearBaseFalsa(conComercios());
    const r = await new EstadisticaService(db).valoraciones({ periodo: '2020-01' });
    igual('total en cero', r.resumen.total, 0);
    igual('positivas en cero', r.resumen.positivas, 0);
    igual('negativas en cero', r.resumen.negativas, 0);
    igual('detalle vacío', r.detalle.length, 0);
  }

  {
    // Clave libre en el detalle: no explota y muestra un rótulo neutro.
    const d = conComercios();
    agregarValoracion(d, 'v1', null, -1, esteMes(1));
    const { db } = crearBaseFalsa(d);
    const r = await new EstadisticaService(db).valoraciones({ periodo: mesActual() });
    igual('cae a un rótulo cuando no hay comercio', r.detalle[0].comercio, 'Sin comercio');
  }

  seccion('Valoraciones: contrato del endpoint');

  {
    prueba(
      'el DTO acepta 👍',
      ValoracionDTO.safeParse({ clave: 'k', instalacion_id: 'i', valoracion: 1, pregunta: 'p', respuesta: 'r' }).success,
    );
    prueba(
      'el DTO acepta 👎',
      ValoracionDTO.safeParse({ clave: 'k', instalacion_id: 'i', valoracion: -1, pregunta: 'p', respuesta: 'r' }).success,
    );
    prueba(
      'rechaza una valoración que no sea 1 ni -1',
      !ValoracionDTO.safeParse({ clave: 'k', instalacion_id: 'i', valoracion: 0, pregunta: 'p', respuesta: 'r' }).success,
    );
    prueba(
      'rechaza la pregunta vacía',
      !ValoracionDTO.safeParse({ clave: 'k', instalacion_id: 'i', valoracion: 1, pregunta: '', respuesta: 'r' }).success,
    );
    prueba(
      'rechaza la respuesta vacía',
      !ValoracionDTO.safeParse({ clave: 'k', instalacion_id: 'i', valoracion: 1, pregunta: 'p', respuesta: '' }).success,
    );

    igual('el filtro acepta un período válido', ValoracionesFiltroDTO.parse({ periodo: '2026-09' }).periodo, '2026-09');
    igual('el filtro sin período queda en undefined', ValoracionesFiltroDTO.parse({}).periodo, undefined);
    await falla('rechaza un período con formato inválido', /período/i, async () =>
      ValoracionesFiltroDTO.parse({ periodo: '2026/09' }),
    );
  }
}
