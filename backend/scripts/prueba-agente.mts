/**
 * Smoke test del agente multi-paso (Fase 2, Binny con function calling).
 *
 * Simula el loop que hará el desktop (Rust) pero con datos falsos, sin tocar
 * la base de datos ni la cuota de ninguna licencia:
 *   1. Envía una pregunta con la definición REAL de herramientas.
 *   2. Espera un evento `herramienta` con SQL válido.
 *   3. Devuelve filas falsas como resultado role:"tool".
 *   4. Verifica que el segundo turno complete (otra herramienta o texto final).
 *
 * Uso: npx tsx scripts/prueba-agente.mts
 * Requiere LLM_API_KEY en el .env (consume llamadas reales al proveedor).
 */
import { llamarLLMAgenteStream, type AgenteMessage } from '../src/features/chat/chat.llm';
import { HERRAMIENTAS_AGENTE } from '../src/features/chat/chat.service';

const SISTEMA = `Sos Binny, asistente de un sistema POS. Respondés en español, simple y sin tecnicismos.

Tenés la herramienta ejecutar_consulta para obtener datos reales del negocio. Podés llamarla VARIAS VECES antes de responder. NUNCA inventes números.

Reglas SQL: solo SELECT o WITH, siempre con LIMIT (máximo 500), fechas como timestamps Unix INTEGER.
"Hoy": DATE(col, 'unixepoch', 'localtime') = DATE('now', 'localtime').

Esquema (SQLite):
venta (id, total, estado, anulada_en, creada_en)
producto (id, nombre, cantidad, stock_minimo, precio_venta, activo)
Enums: venta.estado "completada" | "anulada". Válidas: estado='completada' AND anulada_en IS NULL.`;

async function paso(mensajes: AgenteMessage[], etiqueta: string) {
  console.log(`\n=== ${etiqueta} ===`);
  let texto = '';
  let herramientas: Array<{ id: string; nombre: string; argumentos: string }> = [];
  let error: string | null = null;

  for await (const ev of llamarLLMAgenteStream(mensajes, HERRAMIENTAS_AGENTE)) {
    if (ev.type === 'chunk' && ev.texto) {
      texto += ev.texto;
      process.stdout.write(ev.texto);
    } else if (ev.type === 'herramienta') {
      herramientas = ev.tool_calls;
    } else if (ev.type === 'error') {
      error = ev.texto ?? 'error desconocido';
    } else if (ev.type === 'done') {
      console.log(`\n[done] tokens=${ev.tokens.total_tokens}`);
    }
  }
  if (texto && !texto.endsWith('\n')) console.log();
  return { texto, herramientas, error };
}

async function main() {
  const mensajes: AgenteMessage[] = [
    { role: 'system', content: SISTEMA },
    { role: 'user', content: '¿Cuánto vendí hoy y qué producto tengo con menos stock?' },
  ];

  // Paso 1: el modelo DEBE pedir datos con la herramienta (pregunta multi-dato)
  const r1 = await paso(mensajes, 'Paso 1 (pregunta inicial)');
  if (r1.error) throw new Error(`Paso 1 falló: ${r1.error}`);
  if (r1.herramientas.length === 0) {
    throw new Error('FALLO: el modelo respondió sin usar ejecutar_consulta (se esperaba tool call)');
  }

  const tc = r1.herramientas[0];
  console.log(`\n[tool] ${tc.nombre} id=${tc.id}`);
  console.log(`[tool] args=${tc.argumentos}`);
  const args = JSON.parse(tc.argumentos) as { sql?: string; descripcion?: string };
  if (tc.nombre !== 'ejecutar_consulta' || typeof args.sql !== 'string' || !/^\s*(SELECT|WITH)/i.test(args.sql)) {
    throw new Error('FALLO: tool call con nombre o SQL inesperado');
  }
  console.log(`[tool] descripcion="${args.descripcion ?? ''}"`);
  console.log('OK: tool call válido con SQL de lectura');

  // Paso 2: devolver filas falsas y verificar que el ciclo continúa
  mensajes.push({
    role: 'assistant',
    content: '',
    tool_calls: [{ id: tc.id, type: 'function', function: { name: tc.nombre, arguments: tc.argumentos } }],
  });
  const filasFalsas =
    /venta/i.test(args.sql) || /total/i.test(args.sql)
      ? [{ total_hoy: 45250, cantidad_ventas: 12 }]
      : [{ nombre: 'Leche Entera 1L', cantidad: 3, stock_minimo: 6 }];
  mensajes.push({
    role: 'tool',
    tool_call_id: tc.id,
    content: `Tus datos: (${filasFalsas.length} resultados):\n${JSON.stringify(filasFalsas)}\n\nAnalizá y respondé en español simple. Si necesitás más datos, usá la herramienta otra vez.`,
  });

  const r2 = await paso(mensajes, 'Paso 2 (con resultado de la herramienta)');
  if (r2.error) throw new Error(`Paso 2 falló: ${r2.error}`);
  if (r2.herramientas.length > 0) {
    console.log(`\nOK: el modelo encadenó un 2.º tool call (multi-paso real): ${r2.herramientas[0].nombre}`);
  } else if (r2.texto.trim().length > 0) {
    console.log('\nOK: el modelo cerró con respuesta final en texto');
  } else {
    throw new Error('FALLO: paso 2 sin tool call ni texto');
  }

  console.log('\n✅ Smoke test del agente: EXITOSO');
  // process.exit explícito: importar chat.service registra un setInterval
  // (limpieza de sesiones móviles) que mantiene vivo el event loop.
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n❌ Smoke test del agente: FALLIDO — ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
