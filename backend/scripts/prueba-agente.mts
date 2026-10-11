/**
 * Smoke test del agente multi-paso (Fase 2, Binny con function calling).
 *
 * Simula el loop que hará el desktop (Rust) pero con datos falsos, sin tocar
 * la base de datos ni la cuota de ninguna licencia:
 *   1. Envía una pregunta con la definición REAL de herramientas.
 *   2. Espera un evento `herramienta` con una tool determinista válida.
 *   3. Devuelve un resultado simulado como role:"tool".
 *   4. Verifica que el segundo turno complete (otra herramienta o texto final).
 *
 * El modelo ya NO escribe SQL: solo invoca motores deterministas. Este smoke
 * test usa `ultima_venta` (sin parámetros) como caso mínimo.
 *
 * Uso: npx tsx scripts/prueba-agente.mts
 * Requiere LLM_API_KEY en el .env (consume llamadas reales al proveedor).
 */
import { llamarLLMAgenteStream, type AgenteMessage } from '../src/features/chat/chat.llm';
import { HERRAMIENTAS_AGENTE } from '../src/features/chat/chat.service';

const SISTEMA = `Sos Binny, asistente de un sistema POS. Respondés en español, simple y sin tecnicismos.

Tenés herramientas deterministas que calculan datos exactos del negocio (ultima_venta, ultima_compra, predecir_reposicion, comparar_periodos, etc.). Invocá la que corresponda ANTES de responder y narrá su resultado. NO escribas SQL. NUNCA inventes números: si el dato no está entre los resultados de las herramientas, decí que no lo tenés.`;

const NOMBRES_VALIDOS = new Set(HERRAMIENTAS_AGENTE.map((t) => t.function.name));

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
    { role: 'user', content: '¿Cuál fue mi última venta?' },
  ];

  // Paso 1: el modelo DEBE pedir datos con una herramienta determinista.
  const r1 = await paso(mensajes, 'Paso 1 (pregunta inicial)');
  if (r1.error) throw new Error(`Paso 1 falló: ${r1.error}`);
  if (r1.herramientas.length === 0) {
    throw new Error('FALLO: el modelo respondió sin usar ninguna herramienta (se esperaba tool call)');
  }

  const tc = r1.herramientas[0];
  console.log(`\n[tool] ${tc.nombre} id=${tc.id}`);
  console.log(`[tool] args=${tc.argumentos}`);
  if (!NOMBRES_VALIDOS.has(tc.nombre)) {
    throw new Error(`FALLO: tool call con nombre inesperado: ${tc.nombre}`);
  }
  console.log('OK: tool call válido con una herramienta determinista');

  // Paso 2: devolver un resultado simulado y verificar que el ciclo continúa.
  mensajes.push({
    role: 'assistant',
    content: '',
    tool_calls: [{ id: tc.id, type: 'function', function: { name: tc.nombre, arguments: tc.argumentos } }],
  });
  const resultado =
    tc.nombre === 'ultima_venta'
      ? { venta: { id: 1234, fecha: '2026-10-10 19:42', total: 8750, items: [{ producto: 'Coca-Cola 1.5L', cantidad: 2, precio_unitario: 2500, subtotal: 5000 }], pagos: [{ metodo: 'efectivo', monto: 8750 }] } }
      : { herramienta: tc.nombre, simulado: true, items: [{ producto: 'Coca-Cola 1.5L', reponer: 24 }] };
  mensajes.push({
    role: 'tool',
    tool_call_id: tc.id,
    content: `Resultado de la herramienta:\n${JSON.stringify(resultado)}\n\nAnalizá y respondé en español simple. Si necesitás más datos, usá otra herramienta.`,
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
