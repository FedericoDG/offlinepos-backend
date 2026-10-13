/**
 * Generador del manual de la interfaz en JSON para la FAQ offline (T7).
 *
 * Toma `MANUAL_ENTRADAS` de `src/features/chat/chat.manual.ts` (la fuente de
 * verdad de Binny) y escribe un documento JSON que el POS puede embeber y
 * consumir sin conexión. No toca el prompt de Binny: solo exporta los datos.
 *
 * Forma del documento:
 *   {
 *     "generado_por": "scripts/generar-manual-faq.mts",
 *     "version": 1,
 *     "total_entradas": N,
 *     "entradas": [
 *       { "id", "nombre", "categoria", "como_se_llega", "prerrequisitos",
 *         "pasos": [], "campos_obligatorios": [], "errores_comunes": [],
 *         "palabras_clave": [], "para_que_sirve", "que_podes_hacer": [],
 *         "cantidad_pasos": N }
 *     ]
 *   }
 *
 * `cantidad_pasos` = `pasos.length`; lo usa el capturador de imágenes para
 * saber cuántas fotos esperar por entrada.
 *
 * Destino configurable por la variable de entorno `FAQ_SALIDA` (por defecto, el
 * repo hermano del escritorio, igual que `POS_DESKTOP_SRC` en el verificador de
 * cobertura). El directorio destino se crea si no existe.
 *
 * Uso:
 *   npx tsx scripts/generar-manual-faq.mts
 *   FAQ_SALIDA=/ruta/manual.faq.json npx tsx scripts/generar-manual-faq.mts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MANUAL_ENTRADAS, type EntradaManual } from '../src/features/chat/chat.manual';

/** Versión del formato del JSON; subila si cambia la forma de las entradas. */
export const MANUAL_FAQ_VERSION = 1;

/** Directorio del paquete backend (…/backend). */
const BACKEND_DIR = fileURLToPath(new URL('..', import.meta.url));

/** Ruta por defecto: repo hermano del escritorio (mismo patrón que POS_DESKTOP_SRC). */
const SALIDA_DEFAULT = path.resolve(BACKEND_DIR, '../../sistema_desktop/src/data/manual.faq.json');

export const RUTA_SALIDA = process.env.FAQ_SALIDA
  ? path.resolve(process.env.FAQ_SALIDA)
  : SALIDA_DEFAULT;

/** Entrada del JSON: los mismos datos del manual más `cantidad_pasos`. */
export interface EntradaFaq {
  id: string;
  nombre: string;
  categoria: EntradaManual['categoria'];
  como_se_llega: string;
  prerrequisitos: string;
  pasos: string[];
  campos_obligatorios: string[];
  errores_comunes: string[];
  palabras_clave: string[];
  /** Explicación en lenguaje llano: qué es y para qué sirve la pantalla. */
  para_que_sirve: string;
  /** Cosas concretas que el comerciante puede hacer en la pantalla. */
  que_podes_hacer: string[];
  cantidad_pasos: number;
}

export interface DocumentoFaq {
  generado_por: string;
  version: number;
  total_entradas: number;
  entradas: EntradaFaq[];
}

/** Proyecta una entrada del manual a la forma del JSON de la FAQ. */
export function aEntradaFaq(e: EntradaManual): EntradaFaq {
  return {
    id: e.id,
    nombre: e.nombre,
    categoria: e.categoria,
    como_se_llega: e.como_se_llega,
    prerrequisitos: e.prerrequisitos,
    pasos: e.pasos,
    campos_obligatorios: e.campos_obligatorios,
    errores_comunes: e.errores_comunes,
    palabras_clave: e.palabras_clave,
    para_que_sirve: e.para_que_sirve,
    que_podes_hacer: e.que_podes_hacer,
    cantidad_pasos: e.pasos.length,
  };
}

/** Construye el documento completo a partir de las entradas del manual. */
export function construirDocumentoFaq(entradas: EntradaManual[]): DocumentoFaq {
  const items = entradas.map(aEntradaFaq);
  return {
    generado_por: 'scripts/generar-manual-faq.mts',
    version: MANUAL_FAQ_VERSION,
    total_entradas: items.length,
    entradas: items,
  };
}

function main(): void {
  const documento = construirDocumentoFaq(MANUAL_ENTRADAS);
  fs.mkdirSync(path.dirname(RUTA_SALIDA), { recursive: true });
  fs.writeFileSync(RUTA_SALIDA, `${JSON.stringify(documento, null, 2)}\n`, 'utf8');
  console.log(`Manual de la FAQ generado en: ${RUTA_SALIDA}`);
  console.log(`Total de entradas: ${documento.total_entradas}`);
}

main();
