/**
 * Evaluación del "modo guía" de Binny (T6).
 *
 * Mide si una pregunta de comerciante del tipo "¿cómo…?" produce una GUÍA
 * correcta (prerrequisito → pasos → camino de menú), sin prometer tarjetas ni
 * bloques de creación.
 *
 * Modos:
 *   npx tsx scripts/evaluar-guia.mts         → determinístico (siempre, sin red)
 *   npx tsx scripts/evaluar-guia.mts --llm   → además puntúa al modelo real
 *
 * En modo determinístico valida:
 *   (a) cada pregunta recupera la pantalla esperada del manual
 *       (`recuperarDetalleManual` devuelve la entrada `pantalla_esperada`);
 *   (b) el prompt inyecta el índice del manual y el detalle recuperado;
 *   (c) el prompt NO enseña a emitir bloques de creación en ningún modo;
 *   (d) el corpus está bien formado (ids únicos, pantalla existente, criterios).
 *
 * En modo `--llm` pide al modelo la respuesta de cada pregunta y puntúa
 * `debe_mencionar` (menú/prerrequisito) y `no_debe` (bloques/tarjetas). Escribe
 * el reporte en /tmp/opencode/evaluacion-guia.md.
 *
 * Si el `.env` no tiene credenciales del LLM, el modo `--llm` lo informa y el
 * código de salida queda gobernado por el determinístico.
 */
import fs from 'node:fs';
import path from 'node:path';

import { construirPromptSistema } from '../src/features/chat/chat.service';
import { MANUAL_ENTRADAS, recuperarDetalleManual } from '../src/features/chat/chat.manual';
import {
  CORPUS_GUIA_EVALUACION,
  NO_DEBE_GLOBAL,
  type CasoGuiaEvaluacion,
} from '../src/features/chat/chat.guia.evaluacion';
import type { ContextoNegocioDTO } from '../src/features/chat/chat.dtos';

const MODO_LLM = process.argv.includes('--llm');
const RUTA_REPORTE = '/tmp/opencode/evaluacion-guia.md';

/** Modos cuyo prompt incluye el manual (índice + detalle recuperado). */
const MODOS_CON_MANUAL = ['json', 'stream', 'fase1', 'agente'] as const;
const MODOS = ['json', 'stream', 'fase1', 'agente', 'brief', 'informe'] as const;
const TITULO_INDICE = '## Manual de la interfaz (índice de pantallas)';

/** Identificadores de bloques de creación que NUNCA deben aparecer en el prompt. */
const FENCES_PROHIBIDOS = [
  'crear_producto',
  'crear_proveedor',
  'crear_gasto',
  'crear_recordatorio',
  'crear_compra',
  'crear_combo',
  'cambiar_modulo',
  '```crear',
];

const CONTEXTO: ContextoNegocioDTO = {
  usar_iva: false,
  fecha_actual: '2026-10-08',
  hora_actual: '10:30',
  dia_semana: 'jueves',
  modulos_activos: {
    usar_marca: true, usar_categoria: true, categoria_multiple: false,
    usar_presentaciones: true, usar_iva: false, usar_proveedor: true,
    usar_gastos: true, usar_clientes: true, usar_presupuestos: true,
    usar_combos: true, usar_promociones: true, usar_vencimientos: true,
    usar_etiquetas: true, usar_recargos: true, usar_recordatorios: true,
    usar_balanza: true,
  },
};

// --- Utilidades ---

function normalizar(texto: string): string {
  return (texto ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normalización para comparar texto del modelo contra `debe_mencionar`:
 * además de minúsculas/sin acentos, colapsa espacios y quita los espacios
 * alrededor de "+" (así "Ctrl + K" y "Ctrl+K" son equivalentes).
 */
function normalizarMatch(texto: string): string {
  return normalizar(texto).replace(/\s*\+\s*/g, '+').replace(/\s+/g, ' ').trim();
}

/** Detecta un fence de creación (```crear_producto, ```cambiar_modulo, ...). */
function tieneFenceCreacion(texto: string): string | null {
  const m = texto.match(/```\s*(crear[_-]?\w*|cambiar[_-]?\w*)/i);
  return m ? m[0].trim() : null;
}

const nombrePorId = new Map(MANUAL_ENTRADAS.map((e) => [e.id, e.nombre]));

// --- Verificaciones determinísticas ---

interface Falla {
  check: string;
  detalle: string;
}

function verificarDeterministico(): Falla[] {
  const fallas: Falla[] = [];

  // (d) Corpus bien formado.
  const ids = new Set<string>();
  for (const caso of CORPUS_GUIA_EVALUACION) {
    if (ids.has(caso.id)) fallas.push({ check: `corpus:${caso.id}`, detalle: 'id duplicado' });
    ids.add(caso.id);
    if (!nombrePorId.has(caso.pantalla_esperada)) {
      fallas.push({
        check: `corpus:${caso.id}`,
        detalle: `pantalla_esperada inexistente en el manual: "${caso.pantalla_esperada}"`,
      });
    }
    if (caso.debe_mencionar.length === 0) {
      fallas.push({ check: `corpus:${caso.id}`, detalle: 'sin debe_mencionar' });
    }
  }

  // (a) Recuperación: la pregunta devuelve la pantalla esperada.
  for (const caso of CORPUS_GUIA_EVALUACION) {
    const nombre = nombrePorId.get(caso.pantalla_esperada);
    if (!nombre) continue;
    const detalle = recuperarDetalleManual(caso.pregunta);
    if (!detalle.includes(`### ${nombre}`)) {
      const recuperadas = [...detalle.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
      fallas.push({
        check: `recuperacion:${caso.id}`,
        detalle: `no recuperó "${nombre}" (recuperó: ${recuperadas.join(' | ') || 'nada'})`,
      });
    }
  }

  // (b) El prompt inyecta el manual (índice siempre + detalle por pregunta).
  for (const modo of MODOS_CON_MANUAL) {
    const prompt = construirPromptSistema(modo, CONTEXTO, CORPUS_GUIA_EVALUACION[0].pregunta);
    if (!prompt.includes(TITULO_INDICE)) {
      fallas.push({ check: `prompt:${modo}`, detalle: 'no incluye el índice del manual' });
    }
    const nombre = nombrePorId.get(CORPUS_GUIA_EVALUACION[0].pantalla_esperada);
    if (nombre && !prompt.includes(`### ${nombre}`)) {
      fallas.push({ check: `prompt:${modo}`, detalle: `no inyecta el detalle de "${nombre}"` });
    }
  }

  // (c) Ningún modo enseña a emitir bloques de creación.
  for (const modo of MODOS) {
    const prompt = construirPromptSistema(modo, CONTEXTO, '¿cómo creo un producto?');
    for (const token of FENCES_PROHIBIDOS) {
      if (prompt.includes(token)) {
        fallas.push({ check: `prompt:${modo}`, detalle: `contiene bloque de creación prohibido: ${token}` });
      }
    }
    const fence = tieneFenceCreacion(prompt);
    if (fence) {
      fallas.push({ check: `prompt:${modo}`, detalle: `contiene fence de creación: ${fence}` });
    }
  }

  return fallas;
}

// --- Puntuación de una respuesta del LLM ---

interface PuntajeGuia {
  caso: CasoGuiaEvaluacion;
  texto: string;
  menciona: boolean;
  faltantes: string[];
  sinProhibido: boolean;
  violaciones: string[];
  sinFence: boolean;
  fence: string | null;
  pasa: boolean;
}

function puntuar(caso: CasoGuiaEvaluacion, texto: string): PuntajeGuia {
  const tn = normalizarMatch(texto);
  const faltantes = caso.debe_mencionar.filter((t) => !tn.includes(normalizarMatch(t)));
  const prohibidos = [...caso.no_debe, ...NO_DEBE_GLOBAL];
  const violaciones = prohibidos.filter((t) => tn.includes(normalizarMatch(t)));
  const fence = tieneFenceCreacion(texto);
  const menciona = faltantes.length === 0;
  const sinProhibido = violaciones.length === 0;
  const sinFence = fence === null;
  return {
    caso,
    texto,
    menciona,
    faltantes,
    sinProhibido,
    violaciones,
    sinFence,
    fence,
    pasa: menciona && sinProhibido && sinFence,
  };
}

// --- Modo LLM ---

async function correrLlm(): Promise<{ puntajes: PuntajeGuia[]; nota?: string }> {
  let env: { LLM_API_KEY?: string; LLM_MODEL?: string };
  let llamarLLM: typeof import('../src/features/chat/chat.llm').llamarLLM;
  try {
    env = (await import('../src/config/env')).env;
    ({ llamarLLM } = await import('../src/features/chat/chat.llm'));
  } catch (e) {
    return {
      puntajes: [],
      nota: `No se pudo cargar la configuración del LLM: ${e instanceof Error ? e.message : e}`,
    };
  }

  if (!env.LLM_API_KEY) {
    return { puntajes: [], nota: 'Falta LLM_API_KEY en el .env: se omite el modo LLM.' };
  }

  console.log(`\n[LLM] Modelo: ${env.LLM_MODEL} — evaluando ${CORPUS_GUIA_EVALUACION.length} preguntas...\n`);

  const puntajes: PuntajeGuia[] = [];
  for (const caso of CORPUS_GUIA_EVALUACION) {
    let texto = '';
    try {
      const promptSistema = construirPromptSistema('agente', CONTEXTO, caso.pregunta);
      const { respuesta } = await llamarLLM(
        [
          { role: 'system', content: promptSistema },
          { role: 'user', content: caso.pregunta },
        ],
        { jsonMode: false },
      );
      texto = respuesta.tipo === 'respuesta' ? respuesta.texto : '';
    } catch (e) {
      console.log(`  ✗ ${caso.id}: error del LLM — ${e instanceof Error ? e.message : e}`);
    }
    const p = puntuar(caso, texto);
    puntajes.push(p);
    const detalle = p.pasa ? 'ok' : [
      p.faltantes.length ? `falta: ${p.faltantes.join(', ')}` : '',
      p.violaciones.length ? `prohibido: ${p.violaciones.join(', ')}` : '',
      p.fence ? `fence: ${p.fence}` : '',
    ].filter(Boolean).join(' | ');
    console.log(`  ${p.pasa ? '✓' : '✗'} ${caso.id.padEnd(18)} ${detalle}`);
  }
  return { puntajes };
}

// --- Reporte ---

function escribirReporte(puntajes: PuntajeGuia[], nota?: string): void {
  const total = puntajes.length;
  const ok = puntajes.filter((p) => p.pasa).length;
  const lineas: string[] = [
    '# Evaluación del modo guía de Binny (modo LLM)',
    '',
    `Fecha: ${new Date().toISOString()}`,
    '',
    `## Resultado global: ${ok}/${total} (${total ? Math.round((ok / total) * 100) : 0}%)`,
    '',
  ];
  if (nota) lineas.push(`> ${nota}`, '');
  lineas.push('| id | pantalla | menciona | sin prohibido | sin fence | pasa |');
  lineas.push('| --- | --- | :-: | :-: | :-: | :-: |');
  const s = (b: boolean) => (b ? '✓' : '✗');
  for (const p of puntajes) {
    lineas.push(
      `| ${p.caso.id} | ${p.caso.pantalla_esperada} | ${s(p.menciona)} | ${s(p.sinProhibido)} | ${s(p.sinFence)} | ${s(p.pasa)} |`,
    );
  }
  lineas.push('', '## Respuestas', '');
  for (const p of puntajes) {
    lineas.push(`### ${p.caso.id} — ${p.caso.pregunta}`, '');
    if (p.faltantes.length) lineas.push(`- Faltó mencionar: ${p.faltantes.join(', ')}`);
    if (p.violaciones.length) lineas.push(`- Dijo lo prohibido: ${p.violaciones.join(', ')}`);
    if (p.fence) lineas.push(`- Emitió fence de creación: ${p.fence}`);
    lineas.push('', '```text', p.texto || '(sin respuesta)', '```', '');
  }
  fs.mkdirSync(path.dirname(RUTA_REPORTE), { recursive: true });
  fs.writeFileSync(RUTA_REPORTE, lineas.join('\n'), 'utf8');
}

// --- Main ---

async function main() {
  console.log('=== Evaluación del modo guía de Binny ===');
  console.log(`Corpus: ${CORPUS_GUIA_EVALUACION.length} preguntas "¿cómo…?"\n`);

  const fallas = verificarDeterministico();
  if (fallas.length === 0) {
    console.log('✓ Determinístico: recuperación + prompt (sin bloques) OK');
    for (const modo of MODOS) {
      const p = construirPromptSistema(modo, CONTEXTO, CORPUS_GUIA_EVALUACION[0].pregunta);
      console.log(`  prompt[${modo}] = ${p.length} chars`);
    }
  } else {
    console.log(`✗ Determinístico: ${fallas.length} problema(s)`);
    for (const f of fallas) console.log(`  - [${f.check}] ${f.detalle}`);
  }

  if (!MODO_LLM) {
    console.log('\n(modo determinístico; usá --llm para puntuar al modelo real)');
    process.exit(fallas.length === 0 ? 0 : 1);
  }

  const { puntajes, nota } = await correrLlm();
  escribirReporte(puntajes, nota);
  if (nota) {
    console.log(`\n${nota}`);
    console.log(`Reporte escrito en ${RUTA_REPORTE}`);
    process.exit(fallas.length === 0 ? 0 : 1);
  }

  const total = puntajes.length;
  const ok = puntajes.filter((p) => p.pasa).length;
  console.log('\n--- Scoreboard ---');
  for (const p of puntajes) {
    const s = (b: boolean) => (b ? '✓' : '✗');
    console.log(
      `${p.pasa ? '✓' : '✗'} ${p.caso.id.padEnd(18)} menciona:${s(p.menciona)}` +
      ` prohibido:${s(p.sinProhibido)} fence:${s(p.sinFence)}`,
    );
  }
  console.log(`\nGLOBAL: ${ok}/${total} (${total ? Math.round((ok / total) * 100) : 0}%)`);
  console.log(`Reporte escrito en ${RUTA_REPORTE}`);

  // El código de salida lo gobierna el determinístico (la varianza del modelo
  // no debe volver flaky la suite); el scoreboard LLM es informativo.
  process.exit(fallas.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\n❌ Evaluación falló inesperadamente — ${e instanceof Error ? e.stack ?? e.message : e}`);
  process.exit(1);
});
