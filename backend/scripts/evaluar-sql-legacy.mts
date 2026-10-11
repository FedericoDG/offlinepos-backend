/**
 * [LEGACY / OBSOLETO] Suite de evaluación de Binny (E3) que puntuaba el SQL
 * GENERADO por el modelo.
 *
 * ⚠️  YA NO APLICA. Decisión del producto: Binny dejó de escribir SQL libre y
 * ahora solo usa motores deterministas (que calculan exacto en el desktop) y
 * narra el resultado. `ejecutar_consulta` ya no existe, el esquema SQLite y el
 * banco de ejemplos dejaron de inyectarse en el prompt, y los modos
 * json/stream/fase1 pasaron a narrar/guíar. Por eso esta suite se retira del
 * flujo estándar: se conserva solo como referencia histórica y NO forma parte
 * de la verificación.
 *
 * Verificación vigente:
 *   npx tsx scripts/evaluar-guia.mts          → guía + desambiguación (determinístico)
 *   npx tsx scripts/prueba-binny-e2e.mts      → e2e del agente (narración de motores)
 *
 * Este script avisa y sale con código 0 sin correr nada.
 *
 * Historia (referencia): medía si una pregunta real producía la consulta
 * correcta, con scoring DETERMINÍSTICO (sin base de datos ni licencia):
 *   (a) el prompt se construía e incluía el banco de ejemplos (y NO en brief/informe),
 *   (b) cada SQL del banco pasaba `validarSQL`,
 *   (c) el corpus estaba bien formado (familias válidas, tablas existentes).
 * En modo `--llm` pedía al modelo la consulta de cada pregunta y puntuaba
 * guarda/tablas/columnas/prohibido, escribiendo /tmp/opencode/evaluacion-binny.md.
 */

console.warn(
  [
    '',
    '⚠️  evaluar-sql-legacy.mts — YA NO APLICA.',
    'Binny dejó de escribir SQL libre: ahora usa motores deterministas y narra.',
    'Esta suite puntuaba el SQL generado y se retiró del flujo estándar.',
    'La verificación vigente es:',
    '  - npx tsx scripts/evaluar-guia.mts',
    '  - npx tsx scripts/prueba-binny-e2e.mts',
    'No corre ningún check. Saliendo con código 0.',
    '',
  ].join('\n'),
);

process.exit(0);
