/**
 * Búsqueda de precios mayoristas por nombre.
 *
 * El comerciante escribe en lenguaje natural ("decime el precio de coca cola
 * 500 cm3") y esto tiene que encontrar `COCA-COLA 500ML`. No es un `LIKE`
 * directo: hay que normalizar, separar las unidades que el dump trae pegadas y
 * rankear por cuántos términos coinciden.
 *
 * El texto normalizado se calcula al importar y se guarda en
 * `PrecioMayorista.texto_busqueda`, así cada consulta no normaliza 10.000
 * descripciones.
 */

import type { ClientePrisma } from '../../config/prisma.tipos';

/** Minúsculas, sin acentos y con los espacios colapsados. */
export function normalizar(texto: string): string {
  return (texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Texto normalizado para buscar: descripción + marca, con la puntuación
 * separada y los números y las letras despegados (`BSX25KG` → `bsx 25 kg`,
 * `COCA-COLA` → `coca cola`, `1.5L` → `1.5 l`).
 *
 * Dejar cada término como palabra suelta es lo que permite buscar con límite de
 * palabra: sin esto, el token "1" matchearía dentro de "125".
 */
export function textoDeBusqueda(descripcion: string, marca?: string | null): string {
  return normalizar(`${descripcion} ${marca ?? ''}`)
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Equivalencias de unidades: el comerciante escribe "500 cm3" y el dump dice
 * "500ML". Se normalizan al mismo símbolo para que coincidan.
 */
const UNIDADES: Record<string, string> = {
  cm3: 'ml',
  cc: 'ml',
  mililitro: 'ml',
  mililitros: 'ml',
  lt: 'l',
  lts: 'l',
  litro: 'l',
  litros: 'l',
  kilo: 'kg',
  kilos: 'kg',
  kilogramo: 'kg',
  kilogramos: 'kg',
  gr: 'g',
  grs: 'g',
  gramo: 'g',
  gramos: 'g',
  unidad: 'u',
  unidades: 'u',
};

/** Palabras que no aportan nada: el comerciante pregunta en lenguaje natural. */
const STOPWORDS = new Set([
  'quiero', 'queria', 'necesito', 'saber', 'decime', 'decir', 'deci', 'dime',
  'precio', 'precios', 'cuanto', 'cuanta', 'sale', 'vale', 'cuesta', 'esta',
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al',
  'a', 'en', 'con', 'sin', 'para', 'por', 'y', 'o', 'que', 'cual', 'es', 'son',
  'me', 'te', 'se', 'lo', 'le', 'mi', 'su', 'x', 'mayorista', 'mayoristas',
  // Genéricas: si el comerciante las escribe, no distinguen ningún producto.
  'producto', 'productos', 'articulo', 'articulos', 'item', 'items', 'cosa',
  'no', 'si', 'hay', 'tenes', 'tiene', 'tenia', 'busco', 'buscame', 'tenemos',
]);

/**
 * Términos significativos de la consulta, ya normalizados y con las unidades
 * unificadas. Los números de un solo dígito se conservan: "1 kg" los necesita.
 */
export function tokensDeConsulta(consulta: string): string[] {
  const tokens = normalizar(consulta)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));

  return tokens
    .map((t) => UNIDADES[t] ?? t)
    .filter((t) => t.length > 1 || /\d/.test(t));
}

/** Unidades ya normalizadas: un término así casi no distingue productos. */
const TOKENS_UNIDAD = new Set(['ml', 'l', 'kg', 'g', 'u', 'cc']);

/**
 * Cuánto aporta un término al puntaje. Los números y las unidades pesan 1
 * porque aparecen en miles de productos; las palabras pesan su largo, así
 * "mayonesa" (el sustantivo de la consulta) gana sobre "natura" + "kg".
 */
function pesoDeToken(token: string): number {
  if (TOKENS_UNIDAD.has(token)) return 1;
  if (/^\d+(\.\d+)?$/.test(token)) return 1;
  return token.length;
}

/** Una fila del resultado: el precio de un producto en una cadena. */
export interface PrecioEncontrado {
  ean: string;
  descripcion: string;
  marca: string | null;
  es_ean: boolean;
  precio_con_iva: number;
  precio_min: number;
  precio_max: number;
  sucursales: number;
  /** Bandera del mayorista (lo que el comerciante reconoce como "la cadena"). */
  cadena: string;
  cadena_cuit: string;
  /** Fecha a la que corresponden los precios (cuándo se importó el dump). */
  fecha_precio: string;
  /** Cuántos términos de la consulta aparecen en la descripción. */
  coincidencias: number;
  /** Suma de los largos de los términos que aparecen: pesa más lo distintivo. */
  puntaje: number;
}

export interface ResultadoBusqueda {
  consulta: string;
  tokens: string[];
  encontrados: PrecioEncontrado[];
  /** Cuántos productos coinciden en total (puede ser mucho más que `encontrados`). */
  total: number;
  /**
   * `true` cuando el mejor resultado no cubre la mayoría de los términos: puede
   * que el producto no esté cargado o que el nombre esté escrito distinto. El
   * que responde tiene que ser honesto en vez de inventar.
   */
  dudoso: boolean;
}

/**
 * Busca productos por nombre en todas las cadenas cargadas.
 *
 * Rankea por cantidad de términos que coinciden y, a igualdad, por similitud
 * (`word_similarity` de pg_trgm, que tolera errores de tipeo).
 */
export async function buscarPrecios(
  db: ClientePrisma,
  consulta: string,
  opciones: { limite?: number } = {},
): Promise<ResultadoBusqueda> {
  const tokens = tokensDeConsulta(consulta);
  const limite = opciones.limite ?? 10;

  if (tokens.length === 0) {
    return { consulta, tokens, encontrados: [], total: 0, dudoso: true };
  }

  /**
   * Corre la búsqueda una vez. `todosLosTerminos` decide si el WHERE pide TODOS
   * (estricto) o ALGUNO (amplio).
   */
  async function consultar(todosLosTerminos: boolean) {
    const params: unknown[] = [];
    const condiciones: string[] = [];
    const cuenta: string[] = [];
    const peso: string[] = [];

    tokens.forEach((token) => {
      params.push(`% ${token} %`);
      const pos = `$${params.length}`;
      // Límite de palabra: el texto ya viene con cada término separado, así el
      // token "1" no matchea dentro de "125".
      const campo = `(' ' || p."texto_busqueda" || ' ')`;
      condiciones.push(`${campo} LIKE ${pos}`);
      // `coincidencias` cuenta términos; `puntaje` los pondera por largo, para
      // que un término distintivo ("natura") valga más que uno común ("1", "kg").
      cuenta.push(`(CASE WHEN ${campo} LIKE ${pos} THEN 1 ELSE 0 END)`);
      peso.push(
        `(CASE WHEN ${campo} LIKE ${pos} THEN ${pesoDeToken(token)} ELSE 0 END)`,
      );
    });

    params.push(normalizar(consulta));
    const posConsulta = `$${params.length}`;
    params.push(limite);
    const posLimite = `$${params.length}`;

    const unir = todosLosTerminos ? ' AND ' : ' OR ';

    const filas = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT p."ean", p."descripcion", p."marca", p."es_ean",
              p."precio_con_iva", p."precio_min", p."precio_max", p."sucursales",
              p."importado_en",
              c."bandera_nombre" AS cadena, c."cuit" AS cadena_cuit,
              (${cuenta.join(' + ')}) AS coincidencias,
              (${peso.join(' + ')}) AS puntaje,
              COUNT(*) OVER () AS total_coincidencias
         FROM "PrecioMayorista" p
         JOIN "Cadena" c ON c."id" = p."cadena_id"
        WHERE (${condiciones.join(unir)})
        ORDER BY puntaje DESC,
                 coincidencias DESC,
                 word_similarity(${posConsulta}, p."texto_busqueda") DESC,
                 length(p."descripcion") ASC
        LIMIT ${posLimite}`,
      ...params,
    );

    return filas.map((f) => ({
      ean: String(f.ean),
      descripcion: String(f.descripcion),
      marca: f.marca === null ? null : String(f.marca),
      es_ean: Boolean(f.es_ean),
      precio_con_iva: Number(f.precio_con_iva),
      precio_min: Number(f.precio_min),
      precio_max: Number(f.precio_max),
      sucursales: Number(f.sucursales),
      cadena: String(f.cadena),
      cadena_cuit: String(f.cadena_cuit),
      fecha_precio: new Date(f.importado_en as string).toISOString(),
      coincidencias: Number(f.coincidencias),
      puntaje: Number(f.puntaje),
      total: Number(f.total_coincidencias),
    }));
  }

  /**
   * Primero se pide que aparezcan TODOS los términos: es lo que el comerciante
   * quiso decir y da un resultado preciso ("coca cola 2,25" trae solo las de
   * 2,25 L). Si eso no devuelve nada, se afloja a "alguno" —y ahí sí se avisa
   * que es una aproximación— porque el nombre del mayorista puede diferir del
   * que escribió el comerciante ("mayonesa" vs "MAYO").
   */
  let filas = await consultar(true);
  const estricto = filas.length > 0;

  if (!estricto) {
    filas = await consultar(false);
  }

  // Se devuelven SOLO los que puntúan como el mejor: si no, un término suelto
  // ("natura") arrastra todo lo que lo contenga al pasar.
  const mejorPuntaje = filas[0]?.puntaje ?? 0;
  const encontrados = filas.filter((e) => e.puntaje === mejorPuntaje);

  // El total es cuántos productos coinciden, no cuántos se muestran.
  const totalAmplio = filas[0]?.total ?? 0;
  const total = estricto
    ? totalAmplio
    : // En el camino amplio el COUNT es "alguno de los términos", que exagera:
      // se usa lo que realmente se encontró.
      encontrados.length;

  // Dudoso solo cuando hubo que aflojar y el mejor no cubre la mayoría.
  const mejorCuenta = encontrados[0]?.coincidencias ?? 0;
  const dudoso = !estricto && (mejorCuenta === 0 || mejorCuenta < Math.ceil(tokens.length / 2));

  return { consulta, tokens, encontrados, total, dudoso };
}
