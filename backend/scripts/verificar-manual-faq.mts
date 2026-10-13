/**
 * Verificador del manual de la FAQ offline (T7).
 *
 * Comprueba que el JSON que el POS embebe esté sincronizado con
 * `MANUAL_ENTRADAS` de `src/features/chat/chat.manual.ts` y bien formado:
 *
 *   1. Cada entrada tiene `categoria` con un valor permitido.
 *   2. No hay ids duplicados.
 *   3. El JSON en disco (el del escritorio) coincide con el que genera el
 *      manual (comparación estructural, ignorando el encabezado de generación).
 *   4. Ninguna entrada tiene `pasos` vacío (una FAQ sin pasos no sirve).
 *   5. Todas las entradas tienen `para_que_sirve` no vacío y con largo
 *      razonable (> 80 caracteres) y `que_podes_hacer` con al menos 3 ítems
 *      (la FAQ debe explicar qué es la pantalla, no solo cómo usarla).
 *
 * Si hay problemas, sale con código 1 y los lista. Si todo está bien, imprime
 * `Todo en orden: N/N` y sale con 0.
 *
 * La ruta del JSON es la misma que la del generador: `FAQ_SALIDA` o, por
 * defecto, el repo hermano del escritorio (patrón de `POS_DESKTOP_SRC`).
 *
 * Uso:
 *   npx tsx scripts/verificar-manual-faq.mts
 *   FAQ_SALIDA=/ruta/manual.faq.json npx tsx scripts/verificar-manual-faq.mts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MANUAL_ENTRADAS, type EntradaManual } from '../src/features/chat/chat.manual';

const CATEGORIAS_VALIDAS: ReadonlyArray<EntradaManual['categoria']> = [
  'primeros_pasos',
  'uso_diario',
];

const BACKEND_DIR = fileURLToPath(new URL('..', import.meta.url));
const SALIDA_DEFAULT = path.resolve(BACKEND_DIR, '../../sistema_desktop/src/data/manual.faq.json');
const RUTA_JSON = process.env.FAQ_SALIDA ? path.resolve(process.env.FAQ_SALIDA) : SALIDA_DEFAULT;

/** Proyección a la forma del JSON, idéntica a la del generador. */
function aEntradaFaq(e: EntradaManual) {
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

/** Ordena las claves de forma recursiva para comparar sin depender del orden. */
function canonico(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(canonico);
  if (valor && typeof valor === 'object') {
    const obj = valor as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = canonico(obj[k]);
        return acc;
      }, {});
  }
  return valor;
}

function leerJsonEnDisco(): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(RUTA_JSON, 'utf8'));
  } catch {
    return null;
  }
}

function main(): void {
  console.log('=== Verificación del manual de la FAQ (offline) ===');
  console.log(`JSON en disco: ${RUTA_JSON}`);

  const problemas: string[] = [];

  // 1) Categoría presente y válida.
  for (const e of MANUAL_ENTRADAS) {
    if (!e.categoria || !CATEGORIAS_VALIDAS.includes(e.categoria)) {
      problemas.push(`Entrada "${e.id}": categoría inválida (${String(e.categoria)}).`);
    }
  }

  // 2) Ids duplicados.
  const vistos = new Map<string, number>();
  for (const e of MANUAL_ENTRADAS) vistos.set(e.id, (vistos.get(e.id) ?? 0) + 1);
  for (const [id, veces] of vistos) {
    if (veces > 1) problemas.push(`Id duplicado: "${id}" aparece ${veces} veces.`);
  }

  // 4) Pasos no vacíos.
  for (const e of MANUAL_ENTRADAS) {
    if (e.pasos.length === 0) problemas.push(`Entrada "${e.id}": no tiene pasos (la FAQ quedaría vacía).`);
  }

  // 5) Explicación llana presente y con largo razonable.
  const LARGO_MINIMO_PARA_QUE_SIRVE = 80;
  for (const e of MANUAL_ENTRADAS) {
    const texto = (e.para_que_sirve ?? '').trim();
    if (!texto) {
      problemas.push(`Entrada "${e.id}": no tiene "para_que_sirve" (la FAQ no explica qué es la pantalla).`);
    } else if (texto.length <= LARGO_MINIMO_PARA_QUE_SIRVE) {
      problemas.push(
        `Entrada "${e.id}": "para_que_sirve" es demasiado corto (${texto.length} caracteres; se esperan más de ${LARGO_MINIMO_PARA_QUE_SIRVE}).`,
      );
    }
  }

  // 6) Lista de acciones concretas con al menos 3 ítems.
  const MINIMO_QUE_PODES_HACER = 3;
  for (const e of MANUAL_ENTRADAS) {
    const items = (e.que_podes_hacer ?? []).filter((s) => (s ?? '').trim().length > 0);
    if (items.length < MINIMO_QUE_PODES_HACER) {
      problemas.push(
        `Entrada "${e.id}": "que_podes_hacer" tiene ${items.length} ítems (se esperan al menos ${MINIMO_QUE_PODES_HACER}).`,
      );
    }
  }

  // 3) El JSON en disco coincide con el que genera el manual (ignora encabezado).
  const esperadas = MANUAL_ENTRADAS.map(aEntradaFaq);
  const enDisco = leerJsonEnDisco();
  const entradasDisco =
    enDisco && typeof enDisco === 'object'
      ? (enDisco as { entradas?: unknown }).entradas
      : undefined;
  const coincide =
    JSON.stringify(canonico(entradasDisco)) === JSON.stringify(canonico(esperadas));
  if (!coincide) {
    problemas.push(
      'El JSON en disco no coincide con el manual: corré `npm run generar:manual-faq` y commiteá el JSON.',
    );
  }

  const total = MANUAL_ENTRADAS.length;

  if (problemas.length > 0) {
    console.log('\n❌ Problemas encontrados:');
    for (const p of problemas) console.log(`  - ${p}`);
    process.exit(1);
  }

  console.log(`Todo en orden: ${total}/${total}`);
  process.exit(0);
}

main();
