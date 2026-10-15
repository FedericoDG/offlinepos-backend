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
  /** Sucursales con un precio muy distinto, fuera del rango. */
  sucursales_atipicas: number;
  /** Bandera del mayorista (lo que el comerciante reconoce como "la cadena"). */
  cadena: string;
  /** Id de la cadena en la base. Identifica el producto: (cadena, ean). */
  cadena_id: string;
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
  /** Cuántas coincidencias hay en total (no cuántas se trajeron). */
  total: number;
  /** Página pedida (arranca en 1). */
  pagina: number;
  /** Cuántas filas entran por página. */
  limite: number;
  /**
   * `true` cuando no se encontró con TODOS los términos, hubo que aflojar a
   * "alguno" y **hay resultados para mostrar**: puede que el producto no esté
   * cargado o que el nombre esté escrito distinto, así que el que muestra tiene
   * que ser honesto en vez de inventar. Con cero resultados queda en `false`:
   * no hay nada aproximado que advertir.
   */
  aproximado: boolean;
}

/**
 * Busca productos por nombre en todas las cadenas cargadas.
 *
 * Rankea por cantidad de términos que coinciden y, a igualdad, por similitud
 * (`word_similarity` de pg_trgm, que tolera errores de tipeo).
 *
 * Devuelve **una página**, no todo: el llamador pide `pagina`/`limite` y usa el
 * `total` para armar el paginador.
 */
export async function buscarPrecios(
  db: ClientePrisma,
  consulta: string,
  opciones: { pagina?: number; limite?: number } = {},
): Promise<ResultadoBusqueda> {
  const tokens = tokensDeConsulta(consulta);
  const limite = Math.min(100, Math.max(5, opciones.limite ?? 25));
  const pagina = Math.max(1, opciones.pagina ?? 1);

  if (tokens.length === 0) {
    return { consulta, tokens, encontrados: [], total: 0, pagina, limite, aproximado: false };
  }

  /**
   * Corre la búsqueda una vez. `todosLosTerminos` decide si el WHERE pide TODOS
   * (estricto) o ALGUNO (amplio).
   */
  async function consultar(
    todosLosTerminos: boolean,
    paginaPedida = pagina,
    limitePedido = limite,
  ) {
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
    params.push(limitePedido);
    const posLimite = `$${params.length}`;
    params.push((paginaPedida - 1) * limitePedido);
    const posOffset = `$${params.length}`;

    const unir = todosLosTerminos ? ' AND ' : ' OR ';

    // La CTE calcula coincidencias y puntaje de cada fila candidata; afuera se
    // dejan solo las que puntúan como la mejor y ahí sí se pagina. Hacerlo así
    // —y no recortar primero— es lo que permite que el `total` sea el del
    // conjunto real y que las páginas no se pisen entre sí.
    const filas = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `WITH candidatas AS (
         SELECT p."ean", p."descripcion", p."marca", p."es_ean",
                p."precio_con_iva", p."precio_min", p."precio_max", p."sucursales",
                p."sucursales_atipicas", p."importado_en", p."texto_busqueda",
                c."bandera_nombre" AS cadena, c."id" AS cadena_id, c."cuit" AS cadena_cuit,
                (${cuenta.join(' + ')}) AS coincidencias,
                (${peso.join(' + ')}) AS puntaje
           FROM "PrecioMayorista" p
           JOIN "Cadena" c ON c."id" = p."cadena_id"
          WHERE (${condiciones.join(unir)})
       )
       SELECT *, COUNT(*) OVER () AS total_coincidencias
         FROM candidatas
        WHERE puntaje = (SELECT MAX(puntaje) FROM candidatas)
        ORDER BY puntaje DESC,
                 coincidencias DESC,
                 word_similarity(${posConsulta}, "texto_busqueda") DESC,
                 length("descripcion") ASC,
                 -- Desempate final por algo único de la fila (una cadena tiene
                 -- un solo precio por EAN): sin esto, dos páginas pueden traer
                 -- la misma fila, porque con empates Postgres ordena como
                 -- quiere y LIMIT/OFFSET se pisan.
                 "ean" ASC,
                 "cadena" ASC
        LIMIT ${posLimite} OFFSET ${posOffset}`,
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
      sucursales_atipicas: Number(f.sucursales_atipicas),
      cadena: String(f.cadena),
      cadena_id: String(f.cadena_id),
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
  let totalEstricto = filas[0]?.total ?? 0;

  // Sin filas no viene el total, y "sin filas" puede ser dos cosas muy
  // distintas: que no haya resultados o que hayan pedido una página de más.
  // Se sondea la página 1 para distinguirlas, en vez de degradar a la búsqueda
  // amplia solo porque el paginador se pasó de largo.
  if (totalEstricto === 0 && pagina > 1) {
    const sonda = await consultar(true, 1, 1);
    totalEstricto = sonda[0]?.total ?? 0;

    if (totalEstricto > 0) {
      return {
        consulta,
        tokens,
        encontrados: [],
        total: totalEstricto,
        pagina,
        limite,
        aproximado: false,
      };
    }
  }

  const estricto = totalEstricto > 0;

  if (!estricto) {
    filas = await consultar(false);
  }

  // `total` cuenta las filas del paginador: las que puntúan como el mejor
  // resultado (la CTE ya dejó solo esas).
  return {
    consulta,
    tokens,
    encontrados: filas,
    total: filas[0]?.total ?? 0,
    pagina,
    limite,
    aproximado: !estricto && filas.length > 0,
  };
}
