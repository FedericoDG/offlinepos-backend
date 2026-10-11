/**
 * Espejo determinístico de las guardas que el PRODUCTO aplica al texto final de
 * Binny antes de mostrarlo al comerciante.
 *
 * La batería end-to-end (`scripts/prueba-binny-e2e.mts`) medía el texto CRUDO
 * del modelo: no aplicaba las redes determinísticas que el desktop (Rust,
 * `src-tauri/src/chat.rs`) corre antes de pintar la burbuja. Resultado: la tasa
 * no reflejaba lo que el usuario ve. Este módulo replica esas redes como
 * funciones PURAS (sin red, sin DB) para poder (a) medir el resultado REAL y
 * (b) testearlas por separado.
 *
 * Orden de aplicación (el que pide el producto):
 *   1. `normalizarSeguir`      (ya existe en `chat.service.ts`)
 *   2. `quitarNombresInternos` (ya existe en `chat.service.ts`)
 *   3. `quitarBloquesTecnicos` (espejo de `quitar_bloques_tecnicos` del desktop)
 *   4. `quitarOfertaFinal`     (espejo de `quitar_oferta_final`)
 *   5. `quitarDisculpas`       (espejo de `quitar_disculpas`)
 *
 * NOTA: los criterios del corpus (`sinSql`, `sinDisculpas`, `sinOfertaFinal`,
 * `sinTerminosTecnicos`, `respuestaCompleta`, …) se evalúan DESPUÉS de este
 * espejo, porque ahora miden el resultado real que ve el comerciante.
 *
 * Cada función se compara contra su gemela en Rust: mismas constantes, misma
 * semántica. Si el desktop cambia una lista, hay que reflejarla acá.
 */

import { normalizarSeguir, quitarNombresInternos } from './chat.service';

// ============================================================================
// Utilidades compartidas (espejo de los helpers del desktop)
// ============================================================================

/** Minúsculas sin acentos ni `ñ` (espejo de `minusculas_sin_acentos`). */
export function minusculasSinAcentos(texto: string): string {
  return (texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** `str::lines()` de Rust: corta por `\n`, sin el último vacío y sin `\r`. */
function lineasRust(texto: string): string[] {
  const partes = (texto ?? '').split('\n');
  if (partes.length > 0 && partes[partes.length - 1] === '') partes.pop();
  return partes.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

/** `str::split_inclusive('\n')` de Rust: cada trozo conserva su `\n` final. */
function trozosInclusive(texto: string): string[] {
  const out: string[] = [];
  let inicio = 0;
  for (let i = 0; i < texto.length; i++) {
    if (texto[i] === '\n') {
      out.push(texto.slice(inicio, i + 1));
      inicio = i + 1;
    }
  }
  if (inicio < texto.length) out.push(texto.slice(inicio));
  return out;
}

/** `es_palabra_separada`: `palabra` aparece como token suelto (límites de palabra). */
function esPalabraSeparada(textoMayus: string, palabra: string): boolean {
  for (const token of textoMayus.split(/[^\p{L}\p{N}]/u)) {
    if (token === palabra) return true;
  }
  return false;
}

/** Colapsa espacios/tabuladores repetidos en uno solo (espejo de `colapsar_espacios_de_mas`). */
function colapsarEspaciosDeMas(texto: string): string {
  let out = '';
  let enEspacio = false;
  for (const c of texto) {
    if (c === ' ' || c === '\t') {
      if (!enEspacio) out += ' ';
      enEspacio = true;
    } else {
      out += c;
      enEspacio = false;
    }
  }
  return out;
}

/** Colapsa líneas en blanco seguidas y recorta puntas (espejo de `limpiar_saltos_de_mas`). */
function limpiarSaltosDeMas(texto: string): string {
  let resultado = '';
  let vaciasSeguidas = 0;
  for (const linea of lineasRust(texto)) {
    if (linea.trim().length === 0) {
      vaciasSeguidas++;
      if (vaciasSeguidas > 1) continue;
      resultado += '\n';
    } else {
      vaciasSeguidas = 0;
      resultado += `${linea}\n`;
    }
  }
  return resultado.trim();
}

/**
 * Divide el texto en oraciones conservando su terminador (`.`/`!`/`?`/`…` o
 * salto de línea). Un punto seguido de un no-espacio NO corta (no parte
 * "$12.000"). Espejo de `oraciones`.
 */
function oraciones(texto: string): string[] {
  const out: string[] = [];
  let inicio = 0;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    let corta = false;
    if (c === '\n') {
      corta = true;
    } else if (c === '.' || c === '!' || c === '?' || c === '…') {
      const siguiente = i + 1 < texto.length ? texto[i + 1] : undefined;
      corta = !(siguiente !== undefined && !/\s/.test(siguiente));
    }
    if (corta) {
      out.push(texto.slice(inicio, i + 1));
      inicio = i + 1;
    }
  }
  if (inicio < texto.length) out.push(texto.slice(inicio));
  return out;
}

// ============================================================================
// Guarda (d): quitar bloques técnicos (SQL / código)
// Espejo de `analizar_bloques`, `contenido_parece_sql`, `linea_parece_sql`,
// `texto_tiene_bloque_tecnico` y `quitar_bloques_tecnicos` del desktop.
// ============================================================================

/** Lenguajes de bloque que NUNCA deben llegar a la burbuja. */
const LENGUAJES_TECNICOS = new Set([
  'sql', 'sqlite', 'mysql', 'postgres', 'postgresql', 'psql', 'json', 'js',
  'javascript', 'ts', 'typescript', 'bash', 'sh', 'shell', 'python', 'prisma',
]);

/** Palabras clave que delatan una línea de SQL suelta. */
const CLAVES_SQL_LINEA = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'GROUP BY', 'ORDER BY', 'LIMIT',
  'SUM(', 'ROUND(', 'COUNT(',
];

type Tramo =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'bloque'; tecnico: boolean; crudo: string };

/** Lenguaje declarado por una línea de apertura de bloque (`None` si es ``` pelado). */
function lenguajeDeFence(linea: string): string | null {
  const resto = linea.trimStart().replace(/^`+/, '');
  const token = resto.trim().split(/\s+/)[0] ?? '';
  return token.length === 0 ? null : token.toLowerCase();
}

/** `contenido_parece_sql`: bloque sin lenguaje cuyo contenido es SQL. */
function contenidoPareceSql(contenido: string): boolean {
  const upper = contenido.toUpperCase();
  const tiene = (p: string) => esPalabraSeparada(upper, p);
  if (tiene('SELECT') && tiene('FROM')) return true;
  const createTable = tiene('CREATE') && tiene('TABLE');
  const operacion = tiene('INSERT') || tiene('UPDATE') || tiene('DELETE') || tiene('DROP');
  return (operacion || createTable) && (tiene('FROM') || tiene('INTO') || tiene('SET'));
}

/** `linea_parece_sql`: línea suelta >60 chars con ≥2 palabras clave SQL. */
function lineaPareceSql(linea: string): boolean {
  const l = linea.trim();
  if ([...l].length <= 60) return false;
  const upper = l.toUpperCase();
  let encontradas = 0;
  for (const clave of CLAVES_SQL_LINEA) {
    const presente =
      clave.includes(' ') || clave.endsWith('(')
        ? upper.includes(clave)
        : esPalabraSeparada(upper, clave);
    if (presente) encontradas++;
  }
  return encontradas >= 2;
}

/** Divide el texto en tramos de texto/bloques, marcando los bloques técnicos. */
function analizarBloques(texto: string): Tramo[] {
  const tramos: Tramo[] = [];
  let textoActual = '';
  let bloqueActual: { lenguaje: string | null; crudo: string } | null = null;

  for (const linea of trozosInclusive(texto ?? '')) {
    const esFence = linea.trimStart().startsWith('```');
    if (bloqueActual === null) {
      if (esFence) {
        if (textoActual.length > 0) {
          tramos.push({ tipo: 'texto', texto: textoActual });
          textoActual = '';
        }
        bloqueActual = { lenguaje: lenguajeDeFence(linea), crudo: linea };
      } else {
        textoActual += linea;
      }
    } else {
      bloqueActual.crudo += linea;
      if (esFence) {
        const { lenguaje, crudo } = bloqueActual;
        const tecnico =
          lenguaje !== null ? LENGUAJES_TECNICOS.has(lenguaje) : contenidoPareceSql(crudo);
        tramos.push({ tipo: 'bloque', tecnico, crudo });
        bloqueActual = null;
      }
    }
  }

  if (bloqueActual !== null) {
    const { lenguaje, crudo } = bloqueActual;
    const tecnico =
      lenguaje !== null ? LENGUAJES_TECNICOS.has(lenguaje) : contenidoPareceSql(crudo);
    tramos.push({ tipo: 'bloque', tecnico, crudo });
  }
  if (textoActual.length > 0) tramos.push({ tipo: 'texto', texto: textoActual });
  return tramos;
}

/** `true` si el texto trae un bloque técnico o una línea suelta que parece SQL. */
export function tieneBloqueTecnico(texto: string): boolean {
  return analizarBloques(texto ?? '').some((tramo) =>
    tramo.tipo === 'bloque' ? tramo.tecnico : lineasRust(tramo.texto).some(lineaPareceSql),
  );
}

/**
 * Elimina bloques técnicos y líneas sueltas que parecen SQL, dejando el resto
 * intacto y sin líneas en blanco de más. Los bloques `seguir`/`chart`/
 * `whatsapp`/`mensaje` NO se tocan.
 */
export function quitarBloquesTecnicos(texto: string): string {
  let resultado = '';
  for (const tramo of analizarBloques(texto ?? '')) {
    if (tramo.tipo === 'bloque') {
      if (!tramo.tecnico) resultado += tramo.crudo;
    } else {
      for (const linea of trozosInclusive(tramo.texto)) {
        if (!lineaPareceSql(linea)) resultado += linea;
      }
    }
  }
  return limpiarSaltosDeMas(resultado);
}

// ============================================================================
// Guarda (g): quitar la oferta final redundante
// Espejo de `quitar_bloque_seguir`, `tiene_contenido_sustantivo`,
// `es_oferta_final` y `quitar_oferta_final` del desktop.
// ============================================================================

const FRASES_OFERTA_FINAL = [
  'queres que', 'quieres que', 'te gustaria', 'te muestro', 'te armo',
  'te preparo', 'te genero', 'te paso', 'lo queres', 'queres el detalle',
  'queres ver', 'queres saber',
];

/** Quita un bloque ```seguir (completo o abierto) del texto. */
function quitarBloqueSeguir(texto: string): string {
  const idx = (texto ?? '').toLowerCase().indexOf('```seguir');
  if (idx < 0) return texto;
  const cuerpo = idx + '```seguir'.length;
  const cierre = texto.indexOf('```', cuerpo);
  const fin = cierre < 0 ? texto.length : cierre + 3;
  return texto.slice(0, idx) + texto.slice(fin);
}

/** Índice donde arranca el bloque ```seguir, si existe. */
function inicioBloqueSeguir(texto: string): number | null {
  const idx = (texto ?? '').toLowerCase().indexOf('```seguir');
  return idx < 0 ? null : idx;
}

/** `true` si hay contenido sustantivo: tabla markdown o ≥120 chars útiles. */
function tieneContenidoSustantivo(texto: string): boolean {
  if (lineasRust(texto).some((l) => l.trimStart().startsWith('|'))) return true;
  return [...texto].filter((c) => !/\s/.test(c)).length >= 120;
}

/** `true` si la oración es una pregunta de oferta (arranca con `¿` y trae una frase). */
function esOfertaFinal(oracion: string): boolean {
  const o = oracion.trim();
  if (!o.startsWith('¿')) return false;
  const n = minusculasSinAcentos(o);
  return FRASES_OFERTA_FINAL.some((f) => n.includes(f));
}

/**
 * Quita la última pregunta de OFERTA ("¿Querés que te muestre…?") cuando la
 * respuesta ya tiene contenido sustantivo. Protege la repregunta corta de
 * desambiguación. Conserva el bloque ```seguir posterior.
 */
export function quitarOfertaFinal(texto: string): string {
  const sinSeguir = quitarBloqueSeguir(texto ?? '');
  const restante = quitarBloquesTecnicos(sinSeguir).trim();

  if (!tieneContenidoSustantivo(restante)) return texto;

  const oferta = oraciones(restante)
    .map((o) => o.trim())
    .reverse()
    .find((o) => o.length > 0);
  if (oferta === undefined || !esOfertaFinal(oferta)) return texto;

  // Se borra SOLO antes del bloque `seguir`, que queda intacto.
  const corte = inicioBloqueSeguir(texto) ?? texto.length;
  const inicio = texto.slice(0, corte).lastIndexOf(oferta);
  if (inicio < 0) return texto;

  const sinOferta = texto.slice(0, inicio) + texto.slice(inicio + oferta.length);
  return limpiarSaltosDeMas(sinOferta);
}

// ============================================================================
// Guarda (f): quitar disculpas / auto-referencias
// Espejo de `SENALES_META_DISCULPA`, `texto_es_meta_disculpa` y
// `quitar_disculpas` del desktop.
// ============================================================================

const SENALES_META_DISCULPA = [
  'tenes razon', 'disculpa', 'perdona', 'perdon', 'me equivoque', 'no debi',
  'no debia', 'en este turno', 'no tenia los datos', 'mi error',
  'como te decia antes',
];

/** `true` si el texto trae alguna señal de disculpa/meta. */
export function esMetaDisculpa(texto: string): boolean {
  const n = minusculasSinAcentos(texto ?? '');
  return SENALES_META_DISCULPA.some((s) => n.includes(s));
}

/**
 * Quita las oraciones que contienen una señal de disculpa/meta y limpia los
 * espacios y saltos sobrantes. Si no queda nada, devuelve cadena vacía.
 */
export function quitarDisculpas(texto: string): string {
  let restante = '';
  for (const oracion of oraciones(texto ?? '')) {
    if (!esMetaDisculpa(oracion)) restante += oracion;
  }
  return limpiarSaltosDeMas(colapsarEspaciosDeMas(restante));
}

// ============================================================================
// Aplicación en orden + métrica de disparos
// ============================================================================

/** Qué guarda cambió el texto (métrica informativa; no afecta la nota). */
export interface DisparosGuardas {
  normalizarSeguir: boolean;
  quitarNombresInternos: boolean;
  quitarBloquesTecnicos: boolean;
  quitarOfertaFinal: boolean;
  quitarDisculpas: boolean;
}

export interface ResultadoEspejo {
  /** Texto final tal como lo vería el comerciante. */
  texto: string;
  /** Si cada guarda modificó el texto (o el texto original, en su caso). */
  disparos: DisparosGuardas;
}

/**
 * Aplica TODAS las guardas determinísticas del producto, en orden, y devuelve
 * el texto final junto con qué guarda se disparó. PURA.
 */
export function aplicarGuardasEspejo(textoOriginal: string): ResultadoEspejo {
  const original = textoOriginal ?? '';

  const t1 = normalizarSeguir(original);
  const t2 = quitarNombresInternos(t1);
  const t3 = quitarBloquesTecnicos(t2);
  const t4 = quitarOfertaFinal(t3);
  const t5 = quitarDisculpas(t4);

  return {
    texto: t5,
    disparos: {
      normalizarSeguir: t1 !== original,
      quitarNombresInternos: t2 !== t1,
      quitarBloquesTecnicos: t3 !== t2,
      quitarOfertaFinal: t4 !== t3,
      quitarDisculpas: t5 !== t4,
    },
  };
}
