/**
 * Prueba END-TO-END de Binny (modo agente real).
 *
 * Replica el flujo productivo completo por cada pregunta del corpus
 * `src/features/chat/chat.prueba.e2e.ts`:
 *
 *   1. Prompt de sistema con `construirPromptSistema('agente', contexto, pregunta)`.
 *   2. Llamada al proveedor CON herramientas (`HERRAMIENTAS_AGENTE`) usando la
 *      misma capa que el servicio (`llamarLLMAgenteStream`), no `llamarLLM` suelto.
 *   3. Si el modelo pide `ejecutar_consulta`, se ejecuta el SQL DE VERDAD contra
 *      una COPIA de solo lectura de la base SQLite local (env `POS_DB`, default
 *      `~/.local/share/com.pos.desktop/sistema.db` copiada con `VACUUM INTO`).
 *   4. Se devuelve el resultado con el mismo formato del desktop y se sigue el
 *      loop hasta texto final (máx. 10 pasos con herramientas).
 *   5. Se aplica `limpiarTextoFinal` (normalizarSeguir + barrera anti-nombres
 *      internos, igual que el backend) y se evalúan las reglas del corpus con
 *      las funciones puras de `chat.prueba.e2e.ts`.
 *
 * LIMITACIÓN DOCUMENTADA: las herramientas nativas de analítica
 * (predecir_reposicion, comparar_periodos, obtener_fugas_precio, etc.) y
 * `guardar_memoria` NO se ejecutan acá (viven en el desktop en Rust): se
 * devuelve un resultado SIMULADO razonable, marcado con "simulado":true. Las
 * consultas por `ejecutar_consulta` SÍ se ejecutan de verdad contra la DB.
 *
 * Uso:
 *   npx tsx scripts/prueba-binny-e2e.mts
 *   npx tsx scripts/prueba-binny-e2e.mts --filtro=combo
 *   npx tsx scripts/prueba-binny-e2e.mts --repes=3 --concurrencia=2
 *
 * Salida: /tmp/opencode/prueba-binny-e2e.md. Exit 1 si algún caso falla.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

import { env } from '../src/config/env';
import {
  HERRAMIENTAS_AGENTE,
  construirPromptSistema,
  limpiarTextoFinal,
} from '../src/features/chat/chat.service';
import { normalizarSQL, validarSQL } from '../src/features/chat/chat.guarda';
import { llamarLLMAgenteStream, type AgenteMessage, type AgenteToolCall } from '../src/features/chat/chat.llm';
import {
  CORPUS_PRUEBA_E2E,
  evaluarCasoE2E,
  type CasoPruebaE2E,
  type ResultadoCasoE2E,
} from '../src/features/chat/chat.prueba.e2e';
import type { ContextoNegocioDTO } from '../src/features/chat/chat.dtos';

// --- Argumentos ---
function valorArg(nombre: string): string | undefined {
  const conIgual = process.argv.find((a) => a.startsWith(`${nombre}=`));
  if (conIgual) return conIgual.slice(nombre.length + 1);
  const idx = process.argv.indexOf(nombre);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return undefined;
}

const FILTRO = valorArg('--filtro')?.trim().toLowerCase();
const REPES = Math.max(1, Number(valorArg('--repes') ?? '1') || 1);
const CONCURRENCIA = Math.max(1, Number(valorArg('--concurrencia') ?? '2') || 2);
const RUTA_REPORTE = '/tmp/opencode/prueba-binny-e2e.md';
const MAX_PASOS = 10;
const MAX_JSON_CHARS = 6000;

// --- Contexto del comercio (el desktop lo manda fresco en cada turno) ---

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function contextoActual(): ContextoNegocioDTO {
  const d = new Date();
  const fecha = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return {
    usar_iva: true,
    fecha_actual: fecha,
    hora_actual: hora,
    dia_semana: DIAS[d.getDay()],
    modulos_activos: {
      usar_marca: true,
      usar_categoria: true,
      categoria_multiple: false,
      usar_presentaciones: true,
      usar_iva: true,
      usar_proveedor: true,
      usar_gastos: true,
      usar_clientes: true,
      usar_presupuestos: true,
      usar_combos: true,
      usar_promociones: true,
      usar_vencimientos: true,
      usar_etiquetas: true,
      usar_recargos: true,
      usar_recordatorios: true,
      usar_balanza: false,
    },
  };
}
const CONTEXTO = contextoActual();

// --- Base de datos: copia de solo lectura ---

const DB_ORIGEN =
  process.env.POS_DB ?? path.join(os.homedir(), '.local/share/com.pos.desktop/sistema.db');
const DB_COPIA = '/tmp/opencode/prueba-binny-e2e.db';

function prepararDb(): DatabaseSync {
  if (!fs.existsSync(DB_ORIGEN)) {
    throw new Error(`No existe la base SQLite en ${DB_ORIGEN}. Definí POS_DB o instalá el desktop.`);
  }
  fs.mkdirSync(path.dirname(DB_COPIA), { recursive: true });
  fs.rmSync(DB_COPIA, { force: true });
  try {
    // Copia consistente (incluye lo que esté en el WAL), solo lectura.
    execFileSync('sqlite3', [`file:${DB_ORIGEN}?mode=ro`, `VACUUM INTO '${DB_COPIA}'`], {
      stdio: 'pipe',
    });
  } catch (e) {
    console.warn(`[DB] VACUUM INTO falló (${e instanceof Error ? e.message : e}); copio el archivo tal cual.`);
    fs.copyFileSync(DB_ORIGEN, DB_COPIA);
  }
  return new DatabaseSync(DB_COPIA, { readOnly: true });
}

// --- Ejecución real del SQL ---

interface ResultadoSql {
  filas: Array<Record<string, unknown>>;
  error?: string;
}

function ejecutarSql(db: DatabaseSync, sql: string): ResultadoSql {
  if (!sql.trim()) return { filas: [], error: 'La consulta llegó vacía.' };
  const { sql: normalizado } = normalizarSQL(sql);
  const valida = validarSQL(normalizado);
  if (!valida.valido) {
    return { filas: [], error: `La consulta no es válida: ${valida.error}. Reformulá con SELECT/WITH y LIMIT.` };
  }
  try {
    const filas = db.prepare(normalizado).all() as unknown as Array<Record<string, unknown>>;
    return { filas };
  } catch (e) {
    return { filas: [], error: `Error al ejecutar la consulta: ${e instanceof Error ? e.message : e}.` };
  }
}

/** Recorta las filas manteniendo JSON siempre válido bajo el tope. */
function recortarFilas(filas: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  let n = filas.length;
  while (n > 1 && JSON.stringify(filas.slice(0, n)).length > MAX_JSON_CHARS) {
    n = Math.max(1, Math.floor(n / 2));
  }
  return filas.slice(0, n);
}

/** Mismo formato de resultado que usa el desktop en modo agente. */
function formatearResultado(filas: Array<Record<string, unknown>>): string {
  const usadas = recortarFilas(filas);
  const json = JSON.stringify(usadas);
  return (
    `Tus datos: (${usadas.length} resultados):\n${json}\n\n` +
    `Analizá estos resultados y respondé al comerciante en español simple y sin tecnicismos. ` +
    `Si necesitás más datos de la base para responder bien, usá la herramienta ejecutar_consulta otra vez antes de responder.`
  );
}

// --- Herramientas nativas de analítica / memoria: SIMULADAS ---
// No viven en el backend (se ejecutan en el desktop, en Rust). Se devuelve un
// resultado plausible marcado como simulado para poder ejercitar el loop.

function resultadoSimulado(nombre: string, args: Record<string, unknown>): unknown {
  const base = { herramienta: nombre, simulado: true, limitacion: 'resultado simulado por el banco de pruebas (la herramienta real vive en el desktop)' };
  switch (nombre) {
    case 'guardar_memoria':
      return { ok: true, guardado: true, simulado: true };
    case 'simular_escenario':
      return { ...base, porcentaje: args.porcentaje ?? 10, tipo: args.tipo ?? 'precio', base_dias: 45, delta_facturacion: 12500, supuesto: 'volumen constante' };
    case 'predecir_reposicion':
      return { ...base, items: [{ producto: 'Coca-Cola 1.5L', reponer: 24, cobertura_dias: 5 }, { producto: 'Yerba 1kg', reponer: 10, cobertura_dias: 7 }] };
    case 'obtener_analitica_anomalias':
      return { ...base, anomalias: [{ tipo: 'ticket atipico', referencia: 'venta 1234' }] };
    case 'obtener_pildoras_oportunidad':
      return { ...base, oportunidades: [{ tipo: 'capital parado', producto: 'Vino reserva', monto: 38000 }] };
    case 'comparar_periodos':
      return { ...base, dias: args.dias ?? 30, ventas_actual: 120000, ventas_anterior: 100000, delta_porcentaje: 20, tickets_actual: 40, ticket_promedio_actual: 3000 };
    case 'obtener_analitica_abc':
      return { ...base, clases: { A: [{ producto: 'Coca-Cola', facturacion: 50000 }], B: [], C: [] } };
    case 'obtener_fugas_precio':
      return { ...base, fugas: [{ producto: 'Pan lactal', perdida: 2400, unidades: 12 }] };
    case 'comparar_cajeros':
      return { ...base, cajeros: [{ usuario: 'Ana', turnos: 8, diferencia_caja: 0, ticket_promedio: 3200 }] };
    default:
      return { ...base, error: `herramienta desconocida: ${nombre}` };
  }
}

/** Mensaje que se le devuelve al modelo cuando una llamada a herramienta ilegible. */
const MENSAJE_LLAMADA_INVALIDA =
  'No pude interpretar esa llamada. Reintentá con el formato correcto (ej: {"sql": "SELECT ..."}).';

/** Errores del proveedor de los que el agente puede recuperarse reintentando. */
function esErrorRecuperable(texto: string): boolean {
  return /no pude interpretar la llamada|formato correcto/i.test(texto);
}

// --- Guarda (c) del desktop: el bloque `seguir` NUNCA reemplaza la respuesta ---
// Espeja `texto_solo_tiene_sugerencias` de src-tauri/src/chat.rs: si el texto
// final quedó con SOLO el bloque de sugerencias (o solo 2-4 líneas-pregunta
// sueltas), el desktop pide UNA redacción real antes de mostrarlo. El ejecutor
// replica esa guarda para no medir una burbuja que el producto nunca mostraría.

const INSTRUCCION_SOLO_SUGERENCIAS =
  'Redactá AHORA la respuesta al comerciante con los datos que ya obtuviste; si te falta el dato, consultalo con la herramienta antes de responder. Las sugerencias van después, no en lugar de la respuesta.';

const INICIOS_PREGUNTA_SEGUIR = [
  'como', 'que', 'cual', 'cuanto', 'cuantos', 'cuanta', 'cuando', 'donde',
  'quien', 'por que', 'para que', 'hay', 'tenes', 'podes', 'me conviene',
  'conviene', 'queres', 'mostrame', 'decime', 'dame', 'mostra',
];

/** ¿La línea parece una pregunta o pedido sugerido? (mismo criterio que el desktop). */
function esPreguntaSueltaDeSeguir(linea: string): boolean {
  const t = (linea ?? '').trim();
  if (t.length === 0 || t.length > 70) return false;
  if (/^(?:[-*•]|\d+[.)])(?:\s|$)/.test(t)) return false;
  if (t.startsWith('¿') || t.endsWith('?')) return true;
  const n = t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return INICIOS_PREGUNTA_SEGUIR.some((p) => n.startsWith(p));
}

/** Quita un bloque ```seguir (completo o todavía abierto) del texto. */
function quitarBloqueSeguirAbierto(texto: string): string {
  const idx = (texto ?? '').toLowerCase().indexOf('```seguir');
  if (idx < 0) return texto;
  const antes = texto.slice(0, idx);
  const resto = texto.slice(idx);
  const cierre = resto.indexOf('```', '```seguir'.length);
  return cierre < 0 ? antes : antes + resto.slice(cierre + 3);
}

/** `true` cuando el texto final quedó con SOLO sugerencias y ninguna respuesta. */
function textoSoloTieneSugerencias(texto: string): boolean {
  const restante = quitarBloqueSeguirAbierto(texto ?? '').trim();
  if (restante.length === 0) return true;
  const lineas = restante.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lineas.length < 2 || lineas.length > 4) return false;
  return lineas.every(esPreguntaSueltaDeSeguir);
}

function resolverHerramienta(db: DatabaseSync, tc: AgenteToolCall): string {
  const crudo = (tc.argumentos ?? '').trim();
  let args: Record<string, unknown> = {};
  if (crudo) {
    let parseado: unknown;
    try {
      parseado = JSON.parse(crudo);
    } catch {
      // JSON malformado: NO morir; devolver el error para que el modelo reintente.
      return MENSAJE_LLAMADA_INVALIDA;
    }
    if (!parseado || typeof parseado !== 'object' || Array.isArray(parseado)) {
      return MENSAJE_LLAMADA_INVALIDA;
    }
    args = parseado as Record<string, unknown>;
  }
  if (tc.nombre === 'ejecutar_consulta') {
    const sql = typeof args.sql === 'string' ? args.sql : '';
    if (!sql.trim()) return MENSAJE_LLAMADA_INVALIDA;
    const { filas, error } = ejecutarSql(db, sql);
    if (error) return error; // el modelo puede autocorregirse en el siguiente paso
    return formatearResultado(filas);
  }
  // JSON de argumentos vacío en cualquier herramienta: llamada ilegible.
  if (!crudo) return MENSAJE_LLAMADA_INVALIDA;
  return JSON.stringify(resultadoSimulado(tc.nombre, args));
}

// --- Un turno del agente ---

interface TurnoAgente {
  texto: string;
  acumulado: string;
  toolCalls: AgenteToolCall[];
  error?: string;
}

async function llamarTurno(mensajes: AgenteMessage[], forzar: boolean): Promise<TurnoAgente> {
  let acumulado = '';
  let final: string | null = null;
  let toolCalls: AgenteToolCall[] = [];
  let error: string | undefined;
  const opciones = forzar
    ? { forzarRespuestaFinal: true, sinHerramientas: true, model: env.LLM_MODEL }
    : { model: env.LLM_MODEL };

  for await (const ev of llamarLLMAgenteStream(mensajes, HERRAMIENTAS_AGENTE, opciones)) {
    if (ev.type === 'chunk' && ev.texto) acumulado += ev.texto;
    else if (ev.type === 'done') final = ev.texto;
    else if (ev.type === 'herramienta') toolCalls = ev.tool_calls ?? [];
    else if (ev.type === 'error') error = ev.texto ?? 'error del proveedor';
  }
  return { texto: final ?? acumulado, acumulado, toolCalls, error };
}

// --- Corrida de un caso (repite todo el flujo real) ---

interface CorridaCaso {
  caso: CasoPruebaE2E;
  texto: string;
  resultado: ResultadoCasoE2E;
  pasos: number;
  herramientas: string[];
  error?: string;
  ms: number;
}

async function correrCaso(db: DatabaseSync, caso: CasoPruebaE2E): Promise<CorridaCaso> {
  const inicio = Date.now();
  const mensajes: AgenteMessage[] = [
    { role: 'system', content: construirPromptSistema('agente', CONTEXTO, caso.pregunta) },
    { role: 'user', content: caso.pregunta },
  ];
  let pasos = 0;
  let forzar = false;
  let textoFinal = '';
  let error: string | undefined;
  let reintentoSugerenciasHecho = false;
  const herramientas: string[] = [];

  try {
    while (true) {
      const turno = await llamarTurno(mensajes, forzar);
      if (turno.error) {
        // Una llamada a herramienta que el proveedor no pudo interpretar NO debe
        // matar la corrida: devolvemos un resultado de herramienta con el error y
        // seguimos el ciclo (hasta el tope de pasos).
        if (esErrorRecuperable(turno.error) && pasos < MAX_PASOS) {
          pasos++;
          const id = `llamada_invalida_${pasos}`;
          mensajes.push({
            role: 'assistant',
            content: turno.acumulado,
            tool_calls: [
              { id, type: 'function', function: { name: 'ejecutar_consulta', arguments: '{}' } },
            ],
          });
          mensajes.push({
            role: 'tool',
            tool_call_id: id,
            name: 'ejecutar_consulta',
            content: MENSAJE_LLAMADA_INVALIDA,
          });
          if (pasos >= MAX_PASOS) forzar = true;
          continue;
        }
        error = turno.error;
        break;
      }
      if (turno.toolCalls.length > 0 && !forzar) {
        pasos++;
        herramientas.push(...turno.toolCalls.map((t) => t.nombre));
        mensajes.push({
          role: 'assistant',
          content: turno.acumulado,
          tool_calls: turno.toolCalls.map((t) => ({
            id: t.id,
            type: 'function',
            function: { name: t.nombre, arguments: t.argumentos },
          })),
        });
        for (const tc of turno.toolCalls) {
          mensajes.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.nombre,
            content: resolverHerramienta(db, tc),
          });
        }
        if (pasos >= MAX_PASOS) forzar = true;
        continue;
      }
      textoFinal = turno.texto;
      // Guarda (c) del desktop: el bloque `seguir` NUNCA reemplaza la respuesta.
      // Si el modelo devolvió solo sugerencias (o nada), se pide UNA redacción
      // real más y se sigue el ciclo; recién si vuelve a fallar se corta.
      if (textoSoloTieneSugerencias(textoFinal) && !reintentoSugerenciasHecho) {
        reintentoSugerenciasHecho = true;
        mensajes.push({ role: 'assistant', content: textoFinal });
        mensajes.push({ role: 'user', content: INSTRUCCION_SOLO_SUGERENCIAS });
        continue;
      }
      break;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  // Sin texto final tras agotar los pasos: caso fallido explícito (no excepción).
  if (!textoFinal.trim()) {
    return {
      caso,
      texto: '',
      resultado: { id: caso.id, ok: false, fallas: ['sin-texto-final'], detalle: 'sin-texto-final' },
      pasos,
      herramientas,
      error,
      ms: Date.now() - inicio,
    };
  }

  const final = limpiarTextoFinal(textoFinal ?? '');
  const resultado = evaluarCasoE2E(final, caso);
  return { caso, texto: final, resultado, pasos, herramientas, error, ms: Date.now() - inicio };
}

// --- Pool de concurrencia ---

async function correrConPool(tareas: Array<() => Promise<CorridaCaso>>, limite: number): Promise<CorridaCaso[]> {
  const resultados = new Array<CorridaCaso>(tareas.length);
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= tareas.length) return;
      try {
        resultados[i] = await tareas[i]!();
      } catch (e) {
        // Nunca dejar huecos: una tarea que revienta se reporta como falla.
        resultados[i] = {
          caso: casosFiltrados[i]!,
          texto: '',
          resultado: { id: casosFiltrados[i]!.id, ok: false, fallas: ['excepción'], detalle: `excepción: ${e instanceof Error ? e.message : e}` },
          pasos: 0,
          herramientas: [],
          error: e instanceof Error ? e.message : String(e),
          ms: 0,
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, tareas.length) }, () => worker()));
  return resultados;
}

// --- Reporte ---

function pct(ok: number, total: number): number {
  return total ? Math.round((ok / total) * 100) : 0;
}

function escribirReporte(corridas: CorridaCaso[], nota?: string): void {
  const total = corridas.length;
  const ok = corridas.filter((c) => c.resultado.ok).length;

  const porTipo = new Map<string, { ok: number; total: number }>();
  for (const c of corridas) {
    const acc = porTipo.get(c.caso.tipo) ?? { ok: 0, total: 0 };
    acc.total += 1;
    if (c.resultado.ok) acc.ok += 1;
    porTipo.set(c.caso.tipo, acc);
  }

  // Agrupado por caso (para --repes>1 reportar tasa por caso).
  const porCaso = new Map<string, CorridaCaso[]>();
  for (const c of corridas) {
    const arr = porCaso.get(c.caso.id) ?? [];
    arr.push(c);
    porCaso.set(c.caso.id, arr);
  }

  const lineas: string[] = [
    '# Prueba end-to-end de Binny (modo agente)',
    '',
    `Fecha: ${new Date().toISOString()}`,
    `Modelo: ${env.LLM_MODEL} · filtro: ${FILTRO ?? '(ninguno)'} · repes: ${REPES} · concurrencia: ${CONCURRENCIA}`,
    '',
    `## Resultado global: ${ok}/${total} (${pct(ok, total)}%)`,
    '',
  ];
  if (nota) lineas.push(`> ${nota}`, '');

  lineas.push('## Tasa por tipo', '');
  lineas.push('| tipo | pasa | total | % |');
  lineas.push('| --- | :-: | :-: | :-: |');
  for (const [tipo, acc] of porTipo) {
    lineas.push(`| ${tipo} | ${acc.ok} | ${acc.total} | ${pct(acc.ok, acc.total)}% |`);
  }
  lineas.push('');

  lineas.push('## Detalle por caso', '');
  lineas.push('| id | pregunta | resultado | qué falló |');
  lineas.push('| --- | --- | :-: | --- |');
  for (const [id, reps] of porCaso) {
    const okReps = reps.filter((r) => r.resultado.ok).length;
    const marca = okReps === reps.length ? '✓' : '✗';
    const tasa = REPES > 1 ? ` (${okReps}/${reps.length})` : '';
    const fallas = [...new Set(reps.flatMap((r) => r.resultado.fallas))];
    lineas.push(`| ${id} | ${reps[0]!.caso.pregunta} | ${marca}${tasa} | ${fallas.join('; ') || '—'} |`);
  }
  lineas.push('');

  const fallidas = corridas.filter((c) => !c.resultado.ok);
  if (fallidas.length > 0) {
    lineas.push('## Detalle de las fallas', '');
    for (const c of fallidas) {
      lineas.push(`### ${c.caso.id} — ${c.caso.pregunta}`);
      lineas.push('');
      lineas.push(`- **Qué falló:** ${c.resultado.detalle}`);
      if (c.error) lineas.push(`- **Error:** ${c.error}`);
      lineas.push(`- **Herramientas:** ${c.herramientas.join(', ') || '(ninguna)'} · pasos: ${c.pasos} · ${c.ms}ms`);
      const preview = c.texto.replace(/\s+/g, ' ').trim().slice(0, 300) || '(texto vacío)';
      lineas.push('');
      lineas.push(`> ${preview}`);
      lineas.push('');
    }
  }

  fs.mkdirSync(path.dirname(RUTA_REPORTE), { recursive: true });
  fs.writeFileSync(RUTA_REPORTE, lineas.join('\n'), 'utf8');
}

// --- Main ---

let casosFiltrados: CasoPruebaE2E[] = [];

async function main() {
  console.log('=== Prueba E2E de Binny (modo agente) ===');
  console.log(`Modelo: ${env.LLM_MODEL}`);
  console.log(`Base: ${DB_ORIGEN}`);
  console.log(`Corpus: ${CORPUS_PRUEBA_E2E.length} casos · repes=${REPES} · concurrencia=${CONCURRENCIA}`);

  if (!env.LLM_API_KEY) {
    console.error('✗ Falta LLM_API_KEY en el .env: no se puede correr la prueba E2E.');
    process.exit(1);
  }

  casosFiltrados = FILTRO
    ? CORPUS_PRUEBA_E2E.filter(
        (c) => c.id.toLowerCase().includes(FILTRO) || c.pregunta.toLowerCase().includes(FILTRO),
      )
    : CORPUS_PRUEBA_E2E;

  if (casosFiltrados.length === 0) {
    console.error(`✗ Ningún caso coincide con --filtro=${FILTRO}`);
    process.exit(1);
  }
  console.log(`Casos a correr: ${casosFiltrados.length}${FILTRO ? ` (filtro "${FILTRO}")` : ''}\n`);

  let db: DatabaseSync;
  try {
    db = prepararDb();
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }

  const tareas: Array<() => Promise<CorridaCaso>> = [];
  for (const caso of casosFiltrados) {
    for (let r = 0; r < REPES; r++) {
      tareas.push(() => correrCaso(db, caso));
    }
  }

  const corridas = await correrConPool(tareas, CONCURRENCIA);

  // Scoreboard por consola.
  for (const c of corridas) {
    const marca = c.resultado.ok ? '✓' : '✗';
    const cola = c.resultado.ok
      ? `${c.pasos} pasos · ${c.ms}ms`
      : c.resultado.detalle || c.error || '';
    console.log(`${marca} ${c.caso.id.padEnd(28)} ${cola}`);
  }

  const total = corridas.length;
  const ok = corridas.filter((c) => c.resultado.ok).length;
  console.log('\n--- Tasa por tipo ---');
  const porTipo = new Map<string, { ok: number; total: number }>();
  for (const c of corridas) {
    const acc = porTipo.get(c.caso.tipo) ?? { ok: 0, total: 0 };
    acc.total += 1;
    if (c.resultado.ok) acc.ok += 1;
    porTipo.set(c.caso.tipo, acc);
  }
  for (const [tipo, acc] of porTipo) {
    console.log(`  ${tipo.padEnd(16)} ${acc.ok}/${acc.total} (${pct(acc.ok, acc.total)}%)`);
  }
  console.log(`\nGLOBAL: ${ok}/${total} (${pct(ok, total)}%)`);

  escribirReporte(corridas);
  console.log(`Reporte escrito en ${RUTA_REPORTE}`);

  // Importar el service deja handles abiertos (prisma, timers): cerrar a mano.
  process.exit(ok === total ? 0 : 1);
}

main().catch((e) => {
  console.error(`\n❌ Prueba E2E falló inesperadamente — ${e instanceof Error ? e.stack ?? e.message : e}`);
  process.exit(1);
});
