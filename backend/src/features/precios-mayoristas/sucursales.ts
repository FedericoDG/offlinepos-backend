import type { ClientePrisma } from '../../config/prisma.tipos';

/**
 * Detalle de un producto por sucursal.
 *
 * La franja (mínimo y máximo) dice que el precio varía, pero no dónde. El
 * comerciante compra en UNA sucursal —la que le queda cerca—, así que necesita
 * ver el precio de cada una con su dirección. Se listan de la más barata a la
 * más cara, que es el orden en el que se decide una compra.
 */

/** El precio de un producto en una sucursal, con los datos de esa sucursal. */
export interface PrecioDeSucursal {
  id_sucursal: string;
  nombre: string;
  tipo: string | null;
  calle: string | null;
  numero: string | null;
  barrio: string | null;
  localidad: string | null;
  /** Nombre de la provincia. El dump manda el código ISO (`AR-B`) y se traduce. */
  provincia: string | null;
  codigo_postal: string | null;
  latitud: number | null;
  longitud: number | null;
  precio_con_iva: number;
  precio_sin_iva: number;
  actualizado_en: string;
}

export interface DetalleSucursales {
  ean: string;
  descripcion: string;
  marca: string | null;
  es_ean: boolean;
  cadena: string;
  sucursales: PrecioDeSucursal[];
}

/**
 * Provincias por código ISO 3166-2:AR, que es lo que trae `sucursales.csv`
 * (`AR-B` = Buenos Aires). Mostrar el código crudo no le dice nada a nadie.
 */
const PROVINCIAS: Record<string, string> = {
  'AR-A': 'Salta',
  'AR-B': 'Buenos Aires',
  'AR-C': 'Ciudad Autónoma de Buenos Aires',
  'AR-D': 'San Luis',
  'AR-E': 'Entre Ríos',
  'AR-F': 'La Rioja',
  'AR-G': 'Santiago del Estero',
  'AR-H': 'Chaco',
  'AR-J': 'San Juan',
  'AR-K': 'Catamarca',
  'AR-L': 'La Pampa',
  'AR-M': 'Mendoza',
  'AR-N': 'Misiones',
  'AR-P': 'Formosa',
  'AR-Q': 'Neuquén',
  'AR-R': 'Río Negro',
  'AR-S': 'Santa Fe',
  'AR-T': 'Tucumán',
  'AR-U': 'Chubut',
  'AR-V': 'Tierra del Fuego',
  'AR-W': 'Corrientes',
  'AR-X': 'Córdoba',
  'AR-Y': 'Jujuy',
  'AR-Z': 'Santa Cruz',
};

/** Traduce el código ISO de provincia. Si viene otra cosa, se deja tal cual. */
function provinciaLegible(codigo: string | null): string | null {
  if (!codigo) return null;
  return PROVINCIAS[codigo.trim().toUpperCase()] ?? codigo;
}

/**
 * Devuelve los precios de un producto en todas sus sucursales.
 *
 * `null` cuando el producto no existe en esa cadena: el llamador decide si eso
 * es un 404 o una lista vacía.
 */
export async function sucursalesDeProducto(
  db: ClientePrisma,
  cadenaId: string,
  ean: string,
): Promise<DetalleSucursales | null> {
  const producto = await db.precioMayorista.findUnique({
    where: { cadena_id_ean: { cadena_id: cadenaId, ean } },
    select: {
      ean: true,
      descripcion: true,
      marca: true,
      es_ean: true,
      cadena: { select: { bandera_nombre: true } },
    },
  });

  if (!producto) return null;

  const filas = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT s."id_sucursal", s."nombre", s."tipo", s."calle", s."numero",
            s."barrio", s."localidad", s."provincia", s."codigo_postal",
            s."latitud", s."longitud",
            ps."precio_con_iva", ps."precio_sin_iva", ps."actualizado_en"
       FROM "PrecioSucursal" ps
       JOIN "SucursalCadena" s
         ON s."cadena_id" = ps."cadena_id" AND s."id_sucursal" = ps."id_sucursal"
      WHERE ps."cadena_id" = $1 AND ps."ean" = $2
      ORDER BY ps."precio_con_iva" ASC, s."nombre" ASC`,
    cadenaId,
    ean,
  );

  return {
    ean: producto.ean,
    descripcion: producto.descripcion,
    marca: producto.marca,
    es_ean: producto.es_ean,
    cadena: producto.cadena.bandera_nombre,
    sucursales: filas.map((f) => ({
      id_sucursal: String(f.id_sucursal),
      nombre: String(f.nombre),
      tipo: f.tipo === null ? null : String(f.tipo),
      calle: f.calle === null ? null : String(f.calle),
      numero: f.numero === null ? null : String(f.numero),
      barrio: f.barrio === null ? null : String(f.barrio),
      localidad: f.localidad === null ? null : String(f.localidad),
      provincia: provinciaLegible(f.provincia === null ? null : String(f.provincia)),
      codigo_postal: f.codigo_postal === null ? null : String(f.codigo_postal),
      latitud: f.latitud === null ? null : Number(f.latitud),
      longitud: f.longitud === null ? null : Number(f.longitud),
      precio_con_iva: Number(f.precio_con_iva),
      precio_sin_iva: Number(f.precio_sin_iva),
      actualizado_en: new Date(f.actualizado_en as string).toISOString(),
    })),
  };
}
