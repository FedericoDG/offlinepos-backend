/**
 * Andamiaje de las pruebas: una base en memoria y un par de aserciones.
 *
 * La idea es ejercitar los servicios REALES —los mismos que corren en
 * produccion— cambiandoles nada mas de donde leen los datos. Por eso los
 * servicios reciben el cliente por constructor: aca se les pasa este falso.
 *
 * No es un Prisma completo. Implementa solo las operaciones y las formas de
 * `where` que el codigo del panel usa de verdad; si algun dia se usa una
 * nueva, esto va a fallar de forma ruidosa, que es lo que se quiere.
 */

import type { ClienteRaiz } from '../src/config/prisma.tipos';

// --------------------------------------------------------------- aserciones

let seccionActual = '';
let total = 0;
let fallas = 0;

export function seccion(titulo: string): void {
  seccionActual = titulo;
  console.log(`\n${titulo}`);
}

export function prueba(etiqueta: string, condicion: boolean, detalle?: unknown): void {
  total += 1;
  if (condicion) {
    console.log(`  ok    ${etiqueta}`);
    return;
  }
  fallas += 1;
  console.log(`  FALLA ${etiqueta}`);
  if (detalle !== undefined) console.log(`        obtenido: ${JSON.stringify(detalle)}`);
  process.exitCode = 1;
}

export function igual(etiqueta: string, obtenido: unknown, esperado: unknown): void {
  prueba(
    `${etiqueta} (esperado ${JSON.stringify(esperado)})`,
    JSON.stringify(obtenido) === JSON.stringify(esperado),
    obtenido
  );
}

/** Corre algo que deberia explotar y comprueba el mensaje. */
export async function falla(etiqueta: string, patron: RegExp, operacion: () => Promise<unknown>): Promise<void> {
  let mensaje: string | null = null;
  try {
    await operacion();
  } catch (e: any) {
    mensaje = e?.message ?? String(e);
  }
  prueba(etiqueta, mensaje !== null && patron.test(mensaje), mensaje ?? '(no lanzo ningun error)');
}

export function informe(): void {
  const verde = total - fallas;
  console.log(`\n${'-'.repeat(60)}`);
  console.log(fallas === 0 ? `Todo en orden: ${verde}/${total}` : `${fallas} FALLAS de ${total} comprobaciones`);
  console.log(`${'-'.repeat(60)}\n`);
}

// ------------------------------------------------------------ base en memoria

export interface Datos {
  comercios: any[];
  planes: any[];
  licencias: any[];
  activaciones: any[];
  suscripciones: any[];
  pagos: any[];
}

export function vacia(): Datos {
  return { comercios: [], planes: [], licencias: [], activaciones: [], suscripciones: [], pagos: [] };
}

/** Fechas relativas a hoy, que es como se escriben casi todos los casos. */
export const DIA = 24 * 60 * 60 * 1000;
export function enDias(dias: number): Date {
  return new Date(Date.now() + dias * DIA);
}

/** Operadores de Prisma que esta base falsa entiende. */
const OPERADORES = new Set([
  'equals', 'not', 'gte', 'lte', 'gt', 'lt', 'in', 'notIn', 'contains', 'startsWith', 'endsWith', 'mode',
]);

function esFiltroDeOperadores(condicion: any): boolean {
  return (
    condicion !== null &&
    typeof condicion === 'object' &&
    !(condicion instanceof Date) &&
    !Array.isArray(condicion) &&
    Object.keys(condicion).every((k) => OPERADORES.has(k))
  );
}

function normalizar(v: any): any {
  return v instanceof Date ? v.getTime() : v;
}

/** Compara un valor escalar contra una condicion de Prisma. */
function coincideEscalar(valor: any, condicion: any): boolean {
  if (!esFiltroDeOperadores(condicion)) return normalizar(valor) === normalizar(condicion);

  return Object.entries(condicion).every(([operador, esperado]: [string, any]) => {
    const v = normalizar(valor);
    const e = normalizar(esperado);
    switch (operador) {
      case 'equals': return v === e;
      case 'not': return !coincideEscalar(valor, esperado);
      case 'gte': return v >= e;
      case 'lte': return v <= e;
      case 'gt': return v > e;
      case 'lt': return v < e;
      case 'in': return (esperado as any[]).some((x) => normalizar(x) === v);
      case 'notIn': return !(esperado as any[]).some((x) => normalizar(x) === v);
      case 'contains': {
        const texto = String(valor ?? '');
        const buscado = String(esperado);
        return condicion.mode === 'insensitive'
          ? texto.toLowerCase().includes(buscado.toLowerCase())
          : texto.includes(buscado);
      }
      case 'startsWith': return String(valor ?? '').startsWith(String(esperado));
      case 'endsWith': return String(valor ?? '').endsWith(String(esperado));
      case 'mode': return true;
      default: return false;
    }
  });
}

export function crearBaseFalsa(datos: Datos): { db: ClienteRaiz; datos: Datos } {
  let secuencia = 0;
  const nuevoId = (prefijo: string) => `${prefijo}-${++secuencia}`;

  // Relaciones que el codigo del panel recorre, con su tabla destino para
  // poder filtrar a mas de un nivel (p. ej. pago -> suscripcion -> comercio).
  interface Relacion { tabla: string; lista: boolean; resolver: (fila: any) => any }

  const relaciones: Record<string, Record<string, Relacion>> = {
    suscripcion: {
      comercio: { tabla: 'comercio', lista: false, resolver: (s) => datos.comercios.find((c) => c.id === s.comercio_id) ?? null },
      plan: { tabla: 'plan', lista: false, resolver: (s) => datos.planes.find((p) => p.id === s.plan_id) ?? null },
      pagos: { tabla: 'pago', lista: true, resolver: (s) => datos.pagos.filter((p) => p.suscripcion_id === s.id) },
    },
    licencia: {
      comercio: { tabla: 'comercio', lista: false, resolver: (l) => datos.comercios.find((c) => c.id === l.comercio_id) ?? null },
      activaciones: { tabla: 'activacion', lista: true, resolver: (l) => datos.activaciones.filter((a) => a.licencia_id === l.id) },
    },
    pago: {
      suscripcion: { tabla: 'suscripcion', lista: false, resolver: (p) => datos.suscripciones.find((x) => x.id === p.suscripcion_id) ?? null },
    },
    plan: {
      _count: { tabla: 'plan', lista: false, resolver: (p) => ({ suscripciones: datos.suscripciones.filter((s) => s.plan_id === p.id).length }) },
    },
    comercio: {
      licencias: { tabla: 'licencia', lista: true, resolver: (c) => datos.licencias.filter((l) => l.comercio_id === c.id) },
    },
  };

  function expandir(tabla: string, fila: any, args: any): any {
    if (!fila) return fila;
    const pedidas = { ...(args?.include ?? {}), ...(args?.select ?? {}) };
    const salida = { ...fila };

    for (const [nombre, valor] of Object.entries<any>(pedidas)) {
      if (!valor) continue;
      const relacion = relaciones[tabla]?.[nombre];
      if (!relacion) continue;

      let relacionado = relacion.resolver(fila);

      if (relacion.lista) {
        if (typeof valor === 'object') {
          if (valor.orderBy) relacionado = ordenar(relacionado, valor.orderBy);
          if (valor.take) relacionado = relacionado.slice(0, valor.take);
        }
        salida[nombre] = relacionado.map((sub: any) => expandir(relacion.tabla, sub, valor));
      } else {
        salida[nombre] = relacionado ? expandir(relacion.tabla, relacionado, valor) : null;
      }
    }
    return salida;
  }

  function ordenar(filas: any[], orderBy: any): any[] {
    if (!orderBy) return filas;
    const [campo, direccion] = Object.entries(orderBy)[0] as [string, string];
    return [...filas].sort((a, b) => {
      const x = a[campo] instanceof Date ? a[campo].getTime() : a[campo];
      const y = b[campo] instanceof Date ? b[campo].getTime() : b[campo];
      if (x === y) return 0;
      return (x < y ? -1 : 1) * (direccion === 'desc' ? -1 : 1);
    });
  }

  function filtrar(tabla: string, filas: any[], where: any): any[] {
    if (!where) return filas;
    return filas.filter((fila) => coincideFila(tabla, fila, where));
  }

  /** Un `where` de Prisma, resolviendo relaciones a cualquier profundidad. */
  function coincideFila(tabla: string, fila: any, where: any): boolean {
    if (!fila) return false;

    return Object.entries<any>(where).every(([campo, condicion]) => {
      const relacion = relaciones[tabla]?.[campo];

      if (!relacion) return coincideEscalar(fila[campo], condicion);

      const relacionado = relacion.resolver(fila);

      if (relacion.lista) {
        const lista: any[] = relacionado ?? [];
        if (condicion?.some) return lista.some((sub) => coincideFila(relacion.tabla, sub, condicion.some));
        if (condicion?.every) return lista.every((sub) => coincideFila(relacion.tabla, sub, condicion.every));
        if (condicion?.none) return !lista.some((sub) => coincideFila(relacion.tabla, sub, condicion.none));
        return lista.some((sub) => coincideFila(relacion.tabla, sub, condicion));
      }

      return coincideFila(relacion.tabla, relacionado, condicion);
    });
  }

  function delegado(tabla: string, coleccion: () => any[]) {
    return {
      async findMany(args: any = {}) {
        let filas = filtrar(tabla, coleccion(), args.where);
        filas = ordenar(filas, args.orderBy);
        if (args.skip) filas = filas.slice(args.skip);
        if (args.take) filas = filas.slice(0, args.take);
        return filas.map((f) => expandir(tabla, f, args));
      },
      async findFirst(args: any = {}) {
        const filas = ordenar(filtrar(tabla, coleccion(), args.where), args.orderBy);
        return filas.length ? expandir(tabla, filas[0], args) : null;
      },
      async findUnique(args: any = {}) {
        const filas = filtrar(tabla, coleccion(), args.where);
        return filas.length ? expandir(tabla, filas[0], args) : null;
      },
      async findUniqueOrThrow(args: any = {}) {
        const fila = await this.findUnique(args);
        if (!fila) throw new Error(`No se encontro la fila en ${tabla}`);
        return fila;
      },
      async count(args: any = {}) {
        return filtrar(tabla, coleccion(), args.where).length;
      },
      async aggregate(args: any = {}) {
        const filas = filtrar(tabla, coleccion(), args.where);
        const salida: any = { _count: filas.length };
        if (args._sum) {
          salida._sum = {};
          for (const campo of Object.keys(args._sum)) {
            salida._sum[campo] = filas.reduce((s, f) => s + Number(f[campo] ?? 0), 0);
          }
        }
        return salida;
      },
      async create(args: any) {
        const ahora = new Date();
        const fila = { id: nuevoId(tabla), createdAt: ahora, updatedAt: ahora, ...args.data };
        coleccion().push(fila);
        return expandir(tabla, fila, args);
      },
      async update(args: any) {
        const fila = filtrar(tabla, coleccion(), args.where)[0];
        if (!fila) throw new Error(`No se encontro la fila a actualizar en ${tabla}`);
        for (const [campo, valor] of Object.entries<any>(args.data)) {
          if (valor && typeof valor === 'object' && 'increment' in valor) fila[campo] += valor.increment;
          else if (valor && typeof valor === 'object' && 'decrement' in valor) fila[campo] -= valor.decrement;
          else fila[campo] = valor;
        }
        fila.updatedAt = new Date();
        return expandir(tabla, fila, args);
      },
      async delete(args: any) {
        const filas = coleccion();
        const i = filas.findIndex((f) => f.id === args.where.id);
        if (i < 0) throw new Error(`No se encontro la fila a borrar en ${tabla}`);
        return filas.splice(i, 1)[0];
      },
    };
  }

  const db: any = {
    comercio: delegado('comercio', () => datos.comercios),
    plan: delegado('plan', () => datos.planes),
    licencia: delegado('licencia', () => datos.licencias),
    activacion: delegado('activacion', () => datos.activaciones),
    suscripcion: delegado('suscripcion', () => datos.suscripciones),
    pago: delegado('pago', () => datos.pagos),
    async $transaction(arg: any) {
      // Sin rollback: alcanza para comprobar el resultado de un camino feliz
      // y el mensaje de uno que falla.
      return typeof arg === 'function' ? arg(db) : Promise.all(arg);
    },
  };

  return { db: db as ClienteRaiz, datos };
}
