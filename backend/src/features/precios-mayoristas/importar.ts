/**
 * Ingesta de un dump de SEPA: toma lo que devolvió el parser y lo guarda.
 *
 * Dos ideas mandan acá:
 *
 *   1. **Una fila por (cadena, producto)**, no por producto y sucursal. El dump
 *      trae 176.703 filas para 10.827 productos porque repite el precio en cada
 *      sucursal; acá se agrega y se guarda el representativo + el rango.
 *
 *   2. **Upsert**: si el producto ya está, se actualiza el precio y la fecha; si
 *      no, se crea. Así la tabla NO crece con el tiempo, solo con productos o
 *      cadenas nuevas.
 *
 * El upsert se hace con SQL crudo (`INSERT ... ON CONFLICT`) porque 10.827
 * `upsert` de Prisma en un loop tardan minutos; así tarda segundos.
 */

import type { ClientePrisma, ClienteRaiz } from '../../config/prisma.tipos';
import type { ComercioSepa, ProductoSepa, SucursalSepa } from './parser';
import { textoDeBusqueda } from './busqueda';

/** Un producto ya agregado: una fila de `PrecioMayorista`. */
export interface ProductoAgregado {
  ean: string;
  es_ean: boolean;
  descripcion: string;
  marca: string | null;
  unidad_venta: string | null;
  /** Normalizado para buscar: lo calcula `agregarPorProducto`. */
  texto_busqueda: string;
  precio_con_iva: number;
  precio_sin_iva: number;
  precio_bulto_con_iva: number | null;
  precio_bulto_sin_iva: number | null;
  precio_min: number;
  precio_max: number;
  sucursales: number;
}

export interface EntradaImportacion {
  /** Una fila por bandera: `comercio.csv` puede traer varias. */
  comercios: ComercioSepa[];
  sucursales: SucursalSepa[];
  productos: ProductoSepa[];
  /** Filas que el parser descartó (basura o línea de pie). Solo informativo. */
  descartadas?: number;
}

export interface ReporteCadena {
  cuit: string;
  id_bandera: number;
  razon_social: string;
  bandera_nombre: string;
  productos: { total: number; creados: number; actualizados: number };
}

export interface ReporteImportacion {
  cadenas: ReporteCadena[];
  sucursales: number;
  descartadas: number;
  ms: number;
}

/** Cuántas filas van por sentencia. 500 anda bien con Postgres. */
const TAMANO_LOTE = 500;

/**
 * Agrupa las filas (una por producto y sucursal) en una por producto.
 *
 * El precio representativo es la **moda** (el valor más repetido entre
 * sucursales), no el primero: en un dump real el 57,6% de los productos tiene
 * más de un precio, y el primero puede ser justo la excepción de una sucursal.
 */
export function agregarPorProducto(productos: ProductoSepa[]): ProductoAgregado[] {
  const porEan = new Map<string, ProductoSepa[]>();
  for (const p of productos) {
    const filas = porEan.get(p.ean);
    if (filas) filas.push(p);
    else porEan.set(p.ean, [p]);
  }

  const agregados: ProductoAgregado[] = [];

  for (const [ean, filas] of porEan) {
    const frecuencia = new Map<number, number>();
    for (const f of filas) {
      frecuencia.set(f.precio_con_iva, (frecuencia.get(f.precio_con_iva) ?? 0) + 1);
    }

    let representativo = filas[0];
    let mejorFrecuencia = 0;
    for (const f of filas) {
      const n = frecuencia.get(f.precio_con_iva) ?? 0;
      if (n > mejorFrecuencia) {
        mejorFrecuencia = n;
        representativo = f;
      }
    }

    let min = filas[0].precio_con_iva;
    let max = filas[0].precio_con_iva;
    for (const f of filas) {
      if (f.precio_con_iva < min) min = f.precio_con_iva;
      if (f.precio_con_iva > max) max = f.precio_con_iva;
    }

    agregados.push({
      ean,
      es_ean: representativo.es_ean,
      descripcion: representativo.descripcion,
      marca: representativo.marca,
      unidad_venta: representativo.unidad_venta,
      texto_busqueda: textoDeBusqueda(representativo.descripcion, representativo.marca),
      precio_con_iva: representativo.precio_con_iva,
      precio_sin_iva: representativo.precio_sin_iva,
      precio_bulto_con_iva: representativo.precio_bulto_con_iva,
      precio_bulto_sin_iva: representativo.precio_bulto_sin_iva,
      precio_min: min,
      precio_max: max,
      sucursales: new Set(filas.map((f) => f.id_sucursal)).size,
    });
  }

  return agregados;
}

/** Crea o actualiza la cadena (CUIT + bandera) y devuelve su id. */
async function upsertCadena(tx: ClientePrisma, comercio: ComercioSepa): Promise<string> {
  const filas = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "Cadena"
       ("id", "cuit", "id_bandera_sepa", "id_comercio_sepa", "razon_social",
        "bandera_nombre", "bandera_url", "version_sepa", "actualizado_sepa_en",
        "importado_en", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, now(), now())
     ON CONFLICT ("cuit", "id_bandera_sepa") DO UPDATE SET
       "id_comercio_sepa"    = EXCLUDED."id_comercio_sepa",
       "razon_social"        = EXCLUDED."razon_social",
       "bandera_nombre"      = EXCLUDED."bandera_nombre",
       "bandera_url"         = EXCLUDED."bandera_url",
       "version_sepa"        = EXCLUDED."version_sepa",
       "actualizado_sepa_en" = EXCLUDED."actualizado_sepa_en",
       "importado_en"        = now(),
       "updatedAt"           = now()
     RETURNING "id"`,
    comercio.cuit,
    comercio.id_bandera,
    comercio.id_comercio,
    comercio.razon_social,
    comercio.bandera_nombre,
    comercio.bandera_url,
    comercio.version_sepa,
    comercio.actualizado_en,
  );
  return filas[0].id;
}

/** Crea o actualiza las sucursales de la cadena, en un solo INSERT. */
async function upsertSucursales(
  tx: ClientePrisma,
  cadenaId: string,
  sucursales: SucursalSepa[],
): Promise<void> {
  if (sucursales.length === 0) return;

  const valores: string[] = [];
  const params: unknown[] = [];
  sucursales.forEach((s, i) => {
    const b = i * 14;
    valores.push(
      `(gen_random_uuid(), $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, ` +
        `$${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}, $${b + 12}, $${b + 13}, ` +
        `$${b + 14}::jsonb, now(), now())`,
    );
    params.push(
      cadenaId,
      s.id_sucursal,
      s.nombre,
      s.tipo,
      s.calle,
      s.numero,
      s.barrio,
      s.codigo_postal,
      s.localidad,
      s.provincia,
      s.latitud,
      s.longitud,
      s.observaciones,
      JSON.stringify(s.horarios),
    );
  });

  await tx.$executeRawUnsafe(
    `INSERT INTO "SucursalCadena"
       ("id", "cadena_id", "id_sucursal", "nombre", "tipo", "calle", "numero",
        "barrio", "codigo_postal", "localidad", "provincia", "latitud",
        "longitud", "observaciones", "horarios", "createdAt", "updatedAt")
     VALUES ${valores.join(',')}
     ON CONFLICT ("cadena_id", "id_sucursal") DO UPDATE SET
       "nombre"        = EXCLUDED."nombre",
       "tipo"          = EXCLUDED."tipo",
       "calle"         = EXCLUDED."calle",
       "numero"        = EXCLUDED."numero",
       "barrio"        = EXCLUDED."barrio",
       "codigo_postal" = EXCLUDED."codigo_postal",
       "localidad"     = EXCLUDED."localidad",
       "provincia"     = EXCLUDED."provincia",
       "latitud"       = EXCLUDED."latitud",
       "longitud"      = EXCLUDED."longitud",
       "observaciones" = EXCLUDED."observaciones",
       "horarios"      = EXCLUDED."horarios",
       "updatedAt"     = now()`,
    ...params,
  );
}

/**
 * Upsert de los precios en lotes. Devuelve cuántos se crearon y cuántos se
 * actualizaron, usando el truco de Postgres `xmax = 0` (una fila insertada
 * tiene xmax 0; una actualizada, no).
 */
async function upsertPrecios(
  tx: ClientePrisma,
  cadenaId: string,
  productos: ProductoAgregado[],
  actualizadoEn: Date | null,
): Promise<{ creados: number; actualizados: number }> {
  let creados = 0;
  let actualizados = 0;

  for (let i = 0; i < productos.length; i += TAMANO_LOTE) {
    const lote = productos.slice(i, i + TAMANO_LOTE);
    const valores: string[] = [];
    const params: unknown[] = [];

    lote.forEach((p, j) => {
      const b = j * 15;
      valores.push(
        `(gen_random_uuid(), $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, ` +
          `$${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}, $${b + 12}, ` +
          `$${b + 13}, $${b + 14}, $${b + 15}, now(), now(), now())`,
      );
      params.push(
        cadenaId,
        p.ean,
        p.es_ean,
        p.descripcion,
        p.marca,
        p.unidad_venta,
        p.texto_busqueda,
        p.precio_con_iva,
        p.precio_sin_iva,
        p.precio_bulto_con_iva,
        p.precio_bulto_sin_iva,
        p.precio_min,
        p.precio_max,
        p.sucursales,
        actualizadoEn,
      );
    });

    const resultado = await tx.$queryRawUnsafe<Array<{ creado: boolean }>>(
      `INSERT INTO "PrecioMayorista"
         ("id", "cadena_id", "ean", "es_ean", "descripcion", "marca", "unidad_venta",
          "texto_busqueda", "precio_con_iva", "precio_sin_iva", "precio_bulto_con_iva",
          "precio_bulto_sin_iva", "precio_min", "precio_max", "sucursales",
          "actualizado_en", "importado_en", "createdAt", "updatedAt")
       VALUES ${valores.join(',')}
       ON CONFLICT ("cadena_id", "ean") DO UPDATE SET
         "es_ean"               = EXCLUDED."es_ean",
         "descripcion"          = EXCLUDED."descripcion",
         "texto_busqueda"       = EXCLUDED."texto_busqueda",
         "marca"                = EXCLUDED."marca",
         "unidad_venta"         = EXCLUDED."unidad_venta",
         "precio_con_iva"       = EXCLUDED."precio_con_iva",
         "precio_sin_iva"       = EXCLUDED."precio_sin_iva",
         "precio_bulto_con_iva" = EXCLUDED."precio_bulto_con_iva",
         "precio_bulto_sin_iva" = EXCLUDED."precio_bulto_sin_iva",
         "precio_min"           = EXCLUDED."precio_min",
         "precio_max"           = EXCLUDED."precio_max",
         "sucursales"           = EXCLUDED."sucursales",
         "actualizado_en"       = EXCLUDED."actualizado_en",
         "importado_en"         = now(),
         "updatedAt"            = now()
       RETURNING (xmax = 0) AS creado`,
      ...params,
    );

    for (const fila of resultado) {
      if (fila.creado) creados++;
      else actualizados++;
    }
  }

  return { creados, actualizados };
}

/**
 * Importa un dump completo: las cadenas (una por bandera), sus sucursales y sus
 * precios, todo en una transacción. Si algo falla, no queda nada a medias.
 */
export async function importarDump(
  db: ClienteRaiz,
  entrada: EntradaImportacion,
): Promise<ReporteImportacion> {
  const inicio = Date.now();

  // Se agrupa una sola vez: cada fila de producto pertenece a una bandera.
  const productosPorBandera = new Map<number, ProductoSepa[]>();
  for (const p of entrada.productos) {
    const filas = productosPorBandera.get(p.id_bandera);
    if (filas) filas.push(p);
    else productosPorBandera.set(p.id_bandera, [p]);
  }

  const cadenas = await db.$transaction(
    async (tx) => {
      const reportes: ReporteCadena[] = [];

      for (const comercio of entrada.comercios) {
        const productos = productosPorBandera.get(comercio.id_bandera) ?? [];
        if (productos.length === 0) continue;

        const cadenaId = await upsertCadena(tx, comercio);
        await upsertSucursales(tx, cadenaId, entrada.sucursales);
        const agregados = agregarPorProducto(productos);
        const precios = await upsertPrecios(
          tx,
          cadenaId,
          agregados,
          comercio.actualizado_en,
        );

        reportes.push({
          cuit: comercio.cuit,
          id_bandera: comercio.id_bandera,
          razon_social: comercio.razon_social,
          bandera_nombre: comercio.bandera_nombre,
          productos: {
            total: agregados.length,
            creados: precios.creados,
            actualizados: precios.actualizados,
          },
        });
      }

      return reportes;
    },
    { timeout: 180_000, maxWait: 15_000 },
  );

  return {
    cadenas,
    sucursales: entrada.sucursales.length,
    descartadas: entrada.descartadas ?? 0,
    ms: Date.now() - inicio,
  };
}
