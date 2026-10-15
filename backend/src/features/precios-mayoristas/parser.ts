/**
 * Parser de los CSV de SEPA (Sistema Electrónico de Publicidad de Precios).
 *
 * Los dumps de los mayoristas son texto plano con estas particularidades, todas
 * verificadas sobre un dump real de 176.703 filas:
 *
 *   - Separador `|` (no coma).
 *   - UTF-8 **con BOM** al inicio.
 *   - Saltos **CRLF**.
 *   - El último campo suele venir vacío.
 *   - `comercio.csv` trae una **línea de pie** que no es dato.
 *   - Hay unas pocas filas basura con los campos vacíos.
 *
 * Este módulo es **puro**: no toca la base ni el filesystem. Recibe texto y
 * devuelve objetos. Así se puede testear con los archivos reales.
 */

/** Quita el BOM y los saltos CRLF, y devuelve las líneas no vacías. */
function lineas(texto: string): string[] {
  return texto
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((linea) => linea.trim().length > 0);
}

/**
 * Divide una línea en campos respetando las comillas dobles de la spec.
 *
 * La Res. 448-E/2016 permite que un valor **contenga el separador**: en ese caso
 * (y cuando contiene una comilla) el valor viene encerrado entre comillas
 * dobles, y una comilla literal se escribe duplicada (`""`). Un `split('|')`
 * partiría mal esas filas.
 */
function dividirCampos(linea: string): string[] {
  const campos: string[] = [];
  let actual = '';
  let entreComillas = false;

  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];

    if (c === '"') {
      if (entreComillas && linea[i + 1] === '"') {
        actual += '"';
        i++; // comilla escapada: consume las dos
      } else {
        entreComillas = !entreComillas;
      }
    } else if (c === '|' && !entreComillas) {
      campos.push(actual);
      actual = '';
    } else {
      actual += c;
    }
  }

  campos.push(actual);
  return campos;
}

/** Convierte un número con punto decimal. Vacío o inválido → null. */
function aNumero(valor: string | undefined): number | null {
  if (valor === undefined) return null;
  const limpio = valor.trim();
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/** Texto opcional: vacío → null. */
function aTexto(valor: string | undefined): string | null {
  const limpio = (valor ?? '').trim();
  return limpio ? limpio : null;
}

/** Fecha ISO del dump. Inválida → null. */
function aFecha(valor: string | undefined): Date | null {
  const limpio = (valor ?? '').trim();
  if (!limpio) return null;
  const d = new Date(limpio);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface ComercioSepa {
  id_comercio: number;
  id_bandera: number;
  cuit: string;
  razon_social: string;
  bandera_nombre: string;
  bandera_url: string | null;
  actualizado_en: Date | null;
  version_sepa: string | null;
}

export interface SucursalSepa {
  id_sucursal: string;
  nombre: string;
  tipo: string | null;
  calle: string | null;
  numero: string | null;
  barrio: string | null;
  codigo_postal: string | null;
  localidad: string | null;
  provincia: string | null;
  latitud: number | null;
  longitud: number | null;
  observaciones: string | null;
  /** Los 7 días, con el texto tal cual viene en el dump. */
  horarios: Record<string, string | null>;
}

export interface ProductoSepa {
  id_sucursal: string;
  /** Bandera del comercio a la que pertenece esta fila. */
  id_bandera: number;
  /** EAN-13. Es la llave para cruzar contra el catálogo del comerciante. */
  ean: string;
  /**
   * `productos_ean` del dump: `1` = `ean` es un código real del estándar
   * (GTIN/UPC), `0` = es un código interno del comercio. Solo los `1` se pueden
   * cruzar por código de barras contra el catálogo del comerciante.
   */
  es_ean: boolean;
  descripcion: string;
  marca: string | null;
  unidad_venta: string | null;
  precio_con_iva: number;
  precio_sin_iva: number;
  precio_bulto_con_iva: number | null;
  precio_bulto_sin_iva: number | null;
}

/** Resultado de parsear un archivo: las filas válidas y las que se descartaron. */
export interface Parseo<T> {
  items: T[];
  descartadas: number;
}

/** Encabezados esperados. Si no coinciden, el dump cambió de formato. */
export const ENCABEZADOS = {
  comercio:
    'id_comercio|id_bandera|comercio_cuit|comercio_razon_social|comercio_bandera_nombre|comercio_bandera_url|comercio_ultima_actualizacion|comercio_version_sepa',
  sucursales:
    'id_comercio|id_bandera|id_sucursal|sucursales_nombre|sucursales_tipo|sucursales_calle|sucursales_numero|sucursales_latitud|sucursales_longitud|sucursales_observaciones|sucursales_barrio|sucursales_codigo_postal|sucursales_localidad|sucursales_provincia|sucursales_lunes_horario_atencion|sucursales_martes_horario_atencion|sucursales_miercoles_horario_atencion|sucursales_jueves_horario_atencion|sucursales_viernes_horario_atencion|sucursales_sabado_horario_atencion|sucursales_domingo_horario_atencion',
  productos:
    'id_comercio|id_bandera|id_sucursal|id_producto|productos_ean|id_dun_14|productos_descripcion|productos_marca|precio_unitario_bulto_por_unidad_venta_con_iva|precio_unitario_bulto_por_unidad_venta_sin_iva|unidad_venta|precio_bulto_con_iva|precio_bulto_sin_iva|productos_precio_unitario_con_iva_promo1|productos_precio_unitario_sin_iva_promo1|productos_leyenda_promo1|productos_precio_unitario_con_iva_promo2|productos_precio_unitario_sin_iva_promo2|productos_leyenda_promo2',
} as const;

/** Los 7 días de atención, en el orden en que vienen en el dump. */
const DIAS = [
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
  'domingo',
] as const;

/** Valida que la primera línea sea el encabezado esperado. */
export function validarEncabezado(
  texto: string,
  esperado: string,
): boolean {
  const primera = texto.replace(/^\uFEFF/, '').split(/\r?\n/)[0] ?? '';
  return primera.trim() === esperado;
}

/**
 * `comercio.csv`: una sola fila con los datos del mayorista. La línea de pie
 * ("última actualización: ...") no es dato y se descarta sola: no tiene la
 * cantidad de campos ni un CUIT numérico.
 */
export function parsearComercio(texto: string): Parseo<ComercioSepa> {
  const items: ComercioSepa[] = [];
  let descartadas = 0;

  for (const linea of lineas(texto).slice(1)) {
    const c = dividirCampos(linea);
    const cuit = (c[2] ?? '').trim();
    const idComercio = aNumero(c[0]);

    // La fila válida tiene CUIT numérico de 11 dígitos y un id de comercio.
    if (c.length < 8 || !idComercio || !/^\d{11}$/.test(cuit)) {
      descartadas++;
      continue;
    }

    items.push({
      id_comercio: idComercio,
      id_bandera: aNumero(c[1]) ?? 0,
      cuit,
      razon_social: (c[3] ?? '').trim(),
      bandera_nombre: (c[4] ?? '').trim(),
      bandera_url: aTexto(c[5]),
      actualizado_en: aFecha(c[6]),
      version_sepa: aTexto(c[7]),
    });
  }

  return { items, descartadas };
}

/** `sucursales.csv`: una fila por sucursal del mayorista. */
export function parsearSucursales(texto: string): Parseo<SucursalSepa> {
  const items: SucursalSepa[] = [];
  let descartadas = 0;

  for (const linea of lineas(texto).slice(1)) {
    const c = dividirCampos(linea);
    const idSucursal = (c[2] ?? '').trim();

    if (c.length < 14 || !idSucursal) {
      descartadas++;
      continue;
    }

    const horarios: Record<string, string | null> = {};
    DIAS.forEach((dia, i) => {
      horarios[dia] = aTexto(c[14 + i]);
    });

    items.push({
      id_sucursal: idSucursal,
      nombre: (c[3] ?? '').trim(),
      tipo: aTexto(c[4]),
      calle: aTexto(c[5]),
      numero: aTexto(c[6]),
      latitud: aNumero(c[7]),
      longitud: aNumero(c[8]),
      observaciones: aTexto(c[9]),
      barrio: aTexto(c[10]),
      codigo_postal: aTexto(c[11]),
      localidad: aTexto(c[12]),
      provincia: aTexto(c[13]),
      horarios,
    });
  }

  return { items, descartadas };
}

/**
 * `productos.csv`: una fila por **producto y sucursal**. El EAN viene en
 * `id_producto` (13 dígitos); `productos_ean` es un flag y `id_dun_14` el
 * código de bulto.
 */
export function parsearProductos(texto: string): Parseo<ProductoSepa> {
  const items: ProductoSepa[] = [];
  let descartadas = 0;

  for (const linea of lineas(texto).slice(1)) {
    const c = dividirCampos(linea);
    const ean = (c[3] ?? '').trim();
    const idSucursal = (c[2] ?? '').trim();
    const conIva = aNumero(c[8]);
    const sinIva = aNumero(c[9]);

    // Fila válida: EAN de 13 dígitos, sucursal y los dos precios base.
    if (
      c.length < 12 ||
      !/^\d{13}$/.test(ean) ||
      !idSucursal ||
      conIva === null ||
      sinIva === null
    ) {
      descartadas++;
      continue;
    }

    items.push({
      id_sucursal: idSucursal,
      id_bandera: aNumero(c[1]) ?? 1,
      ean,
      es_ean: (c[4] ?? '').trim() === '1',
      descripcion: (c[6] ?? '').trim(),
      marca: aTexto(c[7]),
      unidad_venta: aTexto(c[10]),
      precio_con_iva: conIva,
      precio_sin_iva: sinIva,
      precio_bulto_con_iva: aNumero(c[11]),
      precio_bulto_sin_iva: aNumero(c[12]),
    });
  }

  return { items, descartadas };
}
