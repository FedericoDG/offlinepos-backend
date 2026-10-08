/**
 * Suite de evaluación de Binny (E3).
 *
 * Objetivo: medir si una pregunta real produce la consulta correcta, con scoring
 * DETERMINÍSTICO (sin base de datos ni licencia). No usa el flujo HTTP con
 * `validarLicenciaChat`: llama al LLM directo (o nada si es modo determinístico).
 *
 * Modos:
 *   npx tsx scripts/evaluar-binny.mts          → determinístico (siempre, sin red)
 *   npx tsx scripts/evaluar-binny.mts --llm    → además puntúa al LLM real (json mode)
 *
 * En modo determinístico valida:
 *   (a) el prompt se construye e incluye el banco (y NO en brief/informe),
 *   (b) cada SQL del banco pasa `validarSQL`,
 *   (c) el corpus está bien formado (familias válidas, tablas existentes).
 *
 * En modo `--llm` pide al modelo la consulta de cada pregunta del corpus y
 * puntúa: ¿pasa `validarSQL`? ¿usa las tablas esperadas? ¿evita lo prohibido?
 * Escribe el reporte en /tmp/opencode/evaluacion-binny.md.
 *
 * Si el `.env` no tiene credenciales del LLM, el modo `--llm` lo informa y sale
 * sin fallar.
 */
import fs from 'node:fs';
import path from 'node:path';

import { construirPromptSistema } from '../src/features/chat/chat.service';
import { validarSQL } from '../src/features/chat/chat.guarda';
import { ESQUEMA_SQLITE } from '../src/features/chat/chat.esquema';
import {
  EJEMPLOS_POR_FAMILIA,
  FAMILIAS_EJEMPLOS,
  ETIQUETAS_FAMILIA,
  type FamiliaEjemplos,
} from '../src/features/chat/chat.ejemplos';
import { CORPUS_EVALUACION, type PreguntaEvaluacion } from '../src/features/chat/chat.evaluacion';
import type { ContextoNegocioDTO } from '../src/features/chat/chat.dtos';

const MODO_LLM = process.argv.includes('--llm');
const RUTA_REPORTE = '/tmp/opencode/evaluacion-binny.md';
const MODOS_CONSULTA = ['json', 'stream', 'fase1', 'agente'] as const;
const MODOS_NARRATIVOS = ['brief', 'informe'] as const;
const TITULO_BANCO = '## Ejemplos de consultas por tipo de pregunta';

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
    usar_balanza: false,
  },
};

// --- Utilidades ---

const escapRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** ¿El texto contiene el identificador como palabra completa? (`\b` no cruza "_"). */
function contienePalabra(texto: string, palabra: string): boolean {
  return new RegExp(`\\b${escapRe(palabra)}\\b`, 'i').test(texto);
}

/** Tablas y vistas declaradas en ESQUEMA_SQLITE (líneas "nombre (col, ...)"). */
function extraerTablasEsquema(): Set<string> {
  const tablas = new Set<string>();
  for (const m of ESQUEMA_SQLITE.matchAll(/^([a-z_][a-z0-9_]*)\s*\(/gm)) {
    tablas.add(m[1]);
  }
  return tablas;
}

const totalEjemplos = FAMILIAS_EJEMPLOS.reduce(
  (acc, f) => acc + EJEMPLOS_POR_FAMILIA[f].length,
  0,
);

// --- Verificaciones determinísticas ---

interface Falla {
  check: string;
  detalle: string;
}

function verificarDeterministico(): { fallas: Falla[]; tablasEsquema: Set<string> } {
  const fallas: Falla[] = [];
  const tablasEsquema = extraerTablasEsquema();

  // (a) El prompt incluye el banco solo en los modos que generan consultas.
  for (const modo of MODOS_CONSULTA) {
    const prompt = construirPromptSistema(modo, CONTEXTO);
    if (!prompt.includes(TITULO_BANCO)) {
      fallas.push({ check: `prompt:${modo}`, detalle: 'no incluye el banco de ejemplos' });
    }
    const incluidos = (prompt.match(/- Pregunta: "/g) ?? []).length;
    if (incluidos < totalEjemplos) {
      fallas.push({
        check: `prompt:${modo}`,
        detalle: `incluye ${incluidos}/${totalEjemplos} ejemplos del banco`,
      });
    }
  }
  for (const modo of MODOS_NARRATIVOS) {
    const prompt = construirPromptSistema(modo, CONTEXTO);
    if (prompt.includes(TITULO_BANCO)) {
      fallas.push({ check: `prompt:${modo}`, detalle: 'no debería incluir el banco (solo narra)' });
    }
  }

  // (b) Cada SQL del banco pasa la guarda.
  for (const familia of FAMILIAS_EJEMPLOS) {
    for (const ejemplo of EJEMPLOS_POR_FAMILIA[familia]) {
      const { valido, error } = validarSQL(ejemplo.sql);
      if (!valido) {
        fallas.push({
          check: `banco:${familia}`,
          detalle: `"${ejemplo.pregunta}" rechazado por validarSQL: ${error}`,
        });
      }
    }
  }

  // (c) El corpus está bien formado.
  const ids = new Set<string>();
  for (const caso of CORPUS_EVALUACION) {
    if (ids.has(caso.id)) {
      fallas.push({ check: `corpus:${caso.id}`, detalle: 'id duplicado' });
    }
    ids.add(caso.id);
    if (!FAMILIAS_EJEMPLOS.includes(caso.familia)) {
      fallas.push({ check: `corpus:${caso.id}`, detalle: `familia inválida "${caso.familia}"` });
    }
    if (caso.tablas_esperadas.length === 0) {
      fallas.push({ check: `corpus:${caso.id}`, detalle: 'sin tablas_esperadas' });
    }
    for (const t of caso.tablas_esperadas) {
      if (!tablasEsquema.has(t)) {
        fallas.push({ check: `corpus:${caso.id}`, detalle: `tabla inexistente en el esquema: "${t}"` });
      }
    }
  }

  return { fallas, tablasEsquema };
}

// --- Puntuación de una consulta generada por el LLM ---

interface PuntajeCaso {
  caso: PreguntaEvaluacion;
  sql: string | null;
  descripcion: string;
  guardaOk: boolean;
  tablasOk: boolean;
  columnasOk: boolean;
  prohibidoOk: boolean;
  pasa: boolean;
}

function puntuar(caso: PreguntaEvaluacion, sql: string | null): PuntajeCaso {
  if (!sql) {
    return {
      caso, sql: null, descripcion: 'sin consulta (respuesta de texto)',
      guardaOk: false, tablasOk: false, columnasOk: false, prohibidoOk: false, pasa: false,
    };
  }
  const guarda = validarSQL(sql);
  const tablasOk = caso.tablas_esperadas.some((t) => contienePalabra(sql, t));
  const columnasOk = (caso.columnas_clave ?? []).every((c) => contienePalabra(sql, c));
  const prohibidoOk = !(caso.prohibido ?? []).some((p) => contienePalabra(sql, p));
  return {
    caso, sql,
    descripcion: guarda.valido ? 'ok' : (guarda.error ?? 'inválida'),
    guardaOk: guarda.valido, tablasOk, columnasOk, prohibidoOk,
    pasa: guarda.valido && tablasOk && columnasOk && prohibidoOk,
  };
}

// --- Modo LLM ---

async function correrLlm(): Promise<{ puntajes: PuntajeCaso[]; nota?: string }> {
  let env: { LLM_API_KEY?: string; LLM_MODEL?: string };
  let llamarLLM: typeof import('../src/features/chat/chat.llm').llamarLLM;
  try {
    env = (await import('../src/config/env')).env;
    ({ llamarLLM } = await import('../src/features/chat/chat.llm'));
  } catch (e) {
    return { puntajes: [], nota: `No se pudo cargar la configuración del LLM: ${e instanceof Error ? e.message : e}` };
  }

  if (!env.LLM_API_KEY) {
    return { puntajes: [], nota: 'Falta LLM_API_KEY en el .env: se omite el modo LLM.' };
  }

  const promptSistema = construirPromptSistema('json', CONTEXTO);
  console.log(`\n[LLM] Modelo: ${env.LLM_MODEL} — evaluando ${CORPUS_EVALUACION.length} preguntas...\n`);

  const puntajes: PuntajeCaso[] = [];
  for (const caso of CORPUS_EVALUACION) {
    let sql: string | null = null;
    try {
      const { respuesta } = await llamarLLM(
        [
          { role: 'system', content: promptSistema },
          { role: 'user', content: caso.pregunta },
        ],
        { jsonMode: true },
      );
      sql = respuesta.tipo === 'consulta' ? respuesta.sql : null;
    } catch (e) {
      console.log(`  ✗ ${caso.id}: error del LLM — ${e instanceof Error ? e.message : e}`);
    }
    const p = puntuar(caso, sql);
    puntajes.push(p);
    console.log(`  ${p.pasa ? '✓' : '✗'} ${caso.id.padEnd(24)} ${p.descripcion}`);
  }
  return { puntajes };
}

// --- Reporte ---

function escribirReporte(puntajes: PuntajeCaso[], nota?: string): void {
  const total = puntajes.length;
  const ok = puntajes.filter((p) => p.pasa).length;

  const porFamilia = new Map<FamiliaEjemplos, { ok: number; total: number }>();
  for (const p of puntajes) {
    const acc = porFamilia.get(p.caso.familia) ?? { ok: 0, total: 0 };
    acc.total += 1;
    if (p.pasa) acc.ok += 1;
    porFamilia.set(p.caso.familia, acc);
  }

  const lineas: string[] = [
    '# Evaluación de Binny (modo LLM)',
    '',
    `Fecha: ${new Date().toISOString()}`,
    '',
    `## Resultado global: ${ok}/${total} (${total ? Math.round((ok / total) * 100) : 0}%)`,
    '',
  ];
  if (nota) lineas.push(`> ${nota}`, '');

  lineas.push('## Por familia', '');
  for (const familia of FAMILIAS_EJEMPLOS) {
    const acc = porFamilia.get(familia);
    if (!acc) continue;
    const pct = acc.total ? Math.round((acc.ok / acc.total) * 100) : 0;
    lineas.push(`- ${ETIQUETAS_FAMILIA[familia]}: ${acc.ok}/${acc.total} (${pct}%)`);
  }
  lineas.push('', '## Detalle por pregunta', '');
  lineas.push('| id | familia | guarda | tablas | columnas | prohibido | pasa |');
  lineas.push('| --- | --- | :-: | :-: | :-: | :-: | :-: |');
  for (const p of puntajes) {
    const s = (b: boolean) => (b ? '✓' : '✗');
    lineas.push(
      `| ${p.caso.id} | ${p.caso.familia} | ${s(p.guardaOk)} | ${s(p.tablasOk)} | ${s(p.columnasOk)} | ${s(p.prohibidoOk)} | ${s(p.pasa)} |`,
    );
  }
  lineas.push('', '## SQL generado', '');
  for (const p of puntajes) {
    lineas.push(`### ${p.caso.id} — ${p.caso.pregunta}`, '', '```sql', p.sql ?? '(sin consulta)', '```', '');
  }

  fs.mkdirSync(path.dirname(RUTA_REPORTE), { recursive: true });
  fs.writeFileSync(RUTA_REPORTE, lineas.join('\n'), 'utf8');
}

// --- Main ---

async function main() {
  console.log('=== Evaluación de Binny ===');
  console.log(`Banco: ${totalEjemplos} ejemplos en ${FAMILIAS_EJEMPLOS.length} familias`);
  console.log(`Corpus: ${CORPUS_EVALUACION.length} preguntas\n`);

  const { fallas } = verificarDeterministico();
  if (fallas.length === 0) {
    console.log('✓ Determinístico: prompt + banco + corpus OK');
    for (const modo of MODOS_CONSULTA) {
      console.log(
        `  prompt[${modo}] = ${construirPromptSistema(modo, CONTEXTO).length} chars` +
        ` (~${Math.round(construirPromptSistema(modo, CONTEXTO).length / 4)} tok)`,
      );
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
  if (nota) {
    console.log(`\n${nota}`);
    escribirReporte(puntajes, nota);
    process.exit(fallas.length === 0 ? 0 : 1);
  }

  const total = puntajes.length;
  const ok = puntajes.filter((p) => p.pasa).length;
  console.log('\n--- Scoreboard ---');
  for (const p of puntajes) {
    const s = (b: boolean) => (b ? '✓' : '✗');
    console.log(
      `${p.pasa ? '✓' : '✗'} ${p.caso.id.padEnd(24)} guarda:${s(p.guardaOk)} tablas:${s(p.tablasOk)}` +
      ` columnas:${s(p.columnasOk)} prohibido:${s(p.prohibidoOk)}`,
    );
  }
  console.log('\n--- Resumen por familia ---');
  const porFamilia = new Map<FamiliaEjemplos, { ok: number; total: number }>();
  for (const p of puntajes) {
    const acc = porFamilia.get(p.caso.familia) ?? { ok: 0, total: 0 };
    acc.total += 1;
    if (p.pasa) acc.ok += 1;
    porFamilia.set(p.caso.familia, acc);
  }
  for (const familia of FAMILIAS_EJEMPLOS) {
    const acc = porFamilia.get(familia);
    if (!acc) continue;
    const pct = acc.total ? Math.round((acc.ok / acc.total) * 100) : 0;
    console.log(`  ${ETIQUETAS_FAMILIA[familia].padEnd(32)} ${acc.ok}/${acc.total} (${pct}%)`);
  }
  console.log(`\nGLOBAL: ${ok}/${total} (${total ? Math.round((ok / total) * 100) : 0}%)`);
  escribirReporte(puntajes, nota);
  console.log(`Reporte escrito en ${RUTA_REPORTE}`);

  process.exit(fallas.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\n❌ Evaluación falló inesperadamente — ${e instanceof Error ? e.stack ?? e.message : e}`);
  process.exit(1);
});
