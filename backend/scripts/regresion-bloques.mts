/**
 * Regresión del diseño SIN bloques de creación (T6 — reemplaza la vieja
 * batería anti-tarjetas, que importaba guardianes ya eliminados).
 *
 * Este script es DETERMINÍSTICO y no necesita red, licencia ni credenciales:
 * verifica por inspección del código que el diseño nuevo se mantenga.
 *
 * Asserts:
 *  (a) `FENCES_AUTORIZADOS` es EXACTAMENTE ['chart', 'whatsapp', 'mensaje'].
 *  (b) Ningún modo del prompt enseña a emitir bloques de creación
 *      (identificadores `crear_*` / `cambiar_modulo` ni fences ```crear…).
 *  (c) `HERRAMIENTAS_AGENTE` contiene solo lectura + analítica + la memoria
 *      (ninguna tool de creación/edición de entidades del negocio).
 *  (d) Los guardianes/símbolos de la etapa de tarjetas ya NO existen:
 *      prometeSinTarjeta, jsonSueltoEntidad, reintentarTarjetaFaltante,
 *      reintentarEntidadBloqueada, quitarFencesBloqueados, desvioEntidadProhibida,
 *      TOOLS_ALTA, FENCE_ALTA_NORM, seccionBloquesAutorizados.
 *
 * Uso:
 *   npx tsx scripts/regresion-bloques.mts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { construirPromptSistema, HERRAMIENTAS_AGENTE } from '../src/features/chat/chat.service';
import type { ContextoNegocioDTO } from '../src/features/chat/chat.dtos';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUTA_SERVICIO = path.join(RAIZ, 'src/features/chat/chat.service.ts');

/** Fences visuales permitidos: solo muestran, no escriben datos del negocio. */
const FENCES_ESPERADOS = ['chart', 'whatsapp', 'mensaje'];

/** Identificadores de bloques de creación prohibidos en el prompt. */
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

/** Tools permitidas: lectura + analítica + memoria (única escritura, no toca datos). */
const TOOLS_ESPERADAS = [
  'ejecutar_consulta',
  'guardar_memoria',
  'simular_escenario',
  'predecir_reposicion',
  'obtener_analitica_anomalias',
  'obtener_pildoras_oportunidad',
  'comparar_periodos',
  'obtener_analitica_abc',
  'obtener_fugas_precio',
  'comparar_cajeros',
];

/** Tools de escritura de entidades que NO deben existir. */
const TOOLS_PROHIBIDAS = [
  'crear_producto',
  'crear_proveedor',
  'crear_gasto',
  'crear_gasto_programado',
  'crear_recordatorio',
  'crear_compra',
  'crear_combo',
  'crear_cliente',
  'cambiar_modulo',
  'modificar_modulos',
];

/** Guardianes/símbolos eliminados en la etapa sin tarjetas. */
const SIMBOLOS_ELIMINADOS = [
  'prometeSinTarjeta',
  'jsonSueltoEntidad',
  'reintentarTarjetaFaltante',
  'reintentarEntidadBloqueada',
  'quitarFencesBloqueados',
  'desvioEntidadProhibida',
  'TOOLS_ALTA',
  'FENCE_ALTA_NORM',
  'seccionBloquesAutorizados',
];

const MODOS = ['json', 'stream', 'fase1', 'agente', 'brief', 'informe'] as const;

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

/** Extrae el literal de FENCES_AUTORIZADOS desde el código fuente. */
function leerFencesAutorizados(): string[] | null {
  const fuente = fs.readFileSync(RUTA_SERVICIO, 'utf8');
  const m = fuente.match(/const\s+FENCES_AUTORIZADOS\s*=\s*\[([^\]]*)\]/);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] ?? x[2]);
}

function main(): void {
  const fallas: string[] = [];
  const ok = (msg: string) => console.log(`  ✓ ${msg}`);
  const fail = (msg: string) => {
    fallas.push(msg);
    console.log(`  ✗ ${msg}`);
  };

  console.log('=== Regresión: Binny sin bloques de creación ===\n');

  // (a) FENCES_AUTORIZADOS exacto.
  console.log('[a] Fences visuales autorizados');
  const fences = leerFencesAutorizados();
  if (!fences) {
    fail('no se pudo leer FENCES_AUTORIZADOS desde chat.service.ts');
  } else if (JSON.stringify(fences) !== JSON.stringify(FENCES_ESPERADOS)) {
    fail(`FENCES_AUTORIZADOS = [${fences.join(', ')}] (esperado: [${FENCES_ESPERADOS.join(', ')}])`);
  } else {
    ok(`FENCES_AUTORIZADOS = [${fences.join(', ')}]`);
  }

  // (b) El prompt no enseña a emitir bloques de creación.
  console.log('\n[b] Prompt sin instrucciones de bloques de creación');
  for (const modo of MODOS) {
    const prompt = construirPromptSistema(modo, CONTEXTO, '¿cómo creo un producto?');
    const hits = FENCES_PROHIBIDOS.filter((t) => prompt.includes(t));
    const fence = prompt.match(/```\s*(crear[_-]?\w*|cambiar[_-]?\w*)/i);
    if (hits.length > 0 || fence) {
      fail(`prompt[${modo}] contiene bloques de creación: ${[...hits, fence?.[0] ?? ''].filter(Boolean).join(', ')}`);
    } else {
      ok(`prompt[${modo}] limpio`);
    }
  }

  // (c) HERRAMIENTAS_AGENTE: solo lectura + analítica + memoria.
  console.log('\n[c] HERRAMIENTAS_AGENTE sin tools de entidades');
  const nombres = HERRAMIENTAS_AGENTE.map((t) => t.function.name);
  const faltan = TOOLS_ESPERADAS.filter((t) => !nombres.includes(t));
  const sobran = nombres.filter((t) => !TOOLS_ESPERADAS.includes(t));
  const prohibidas = nombres.filter((t) => TOOLS_PROHIBIDAS.includes(t));
  if (faltan.length > 0) fail(`faltan tools esperadas: ${faltan.join(', ')}`);
  if (sobran.length > 0) fail(`tools inesperadas: ${sobran.join(', ')}`);
  if (prohibidas.length > 0) fail(`tools de escritura presentes: ${prohibidas.join(', ')}`);
  if (faltan.length === 0 && sobran.length === 0 && prohibidas.length === 0) {
    ok(`${nombres.length} tools, todas de lectura/analítica/memoria`);
  }

  // (d) Los guardianes eliminados no existen.
  console.log('\n[d] Símbolos de la etapa de tarjetas eliminados');
  const fuente = fs.readFileSync(RUTA_SERVICIO, 'utf8');
  const presentes = SIMBOLOS_ELIMINADOS.filter((s) =>
    new RegExp(`\\b${s}\\b`).test(fuente),
  );
  if (presentes.length > 0) {
    fail(`siguen presentes en chat.service.ts: ${presentes.join(', ')}`);
  } else {
    ok(`${SIMBOLOS_ELIMINADOS.length} símbolos eliminados verificados`);
  }

  console.log('');
  if (fallas.length > 0) {
    console.log(`❌ ${fallas.length} problema(s):`);
    for (const f of fallas) console.log(`   - ${f}`);
    process.exit(1);
  }
  console.log('✓ Diseño sin bloques de creación intacto.');
  process.exit(0);
}

main();
