/**
 * Batería de regresión anti-razonamiento-visible y anti-bloque-improvisado.
 *
 * Casos "trampa": pedidos sin bloque dedicado (cliente, combo, precios) más
 * el caso original del bug (proveedor) y regresión de producto normal.
 *
 * Asserts por caso:
 *  (a) los fences emitidos pertenecen a la lista cerrada autorizada,
 *  (b) el texto final no contiene marcadores de deliberación interna
 *      (usa el MISMO detector que el backend loguea en producción),
 *  (c) el caso proveedor emite crear_proveedor y NUNCA crear_producto.
 *
 * Uso:
 *   BINNY_TEST_CLAVE=... BINNY_TEST_INSTALACION=... npx tsx scripts/regresion-bloques.mts
 *
 * Cada caso consume 1 mensaje de cuota (ciclo completo). Total: ~6/corrida.
 */
import { detectarDeliberacion } from '../src/features/chat/chat.llm';
import { prometeSinTarjeta, jsonSueltoEntidad } from '../src/features/chat/chat.service';
import { costoUSD, fmtUSD } from '../src/features/chat/chat.pricing';

const BASE = process.env.BINNY_TEST_BASE ?? 'http://localhost:4000';
const CLAVE = process.env.BINNY_TEST_CLAVE ?? '';
const INSTALACION = process.env.BINNY_TEST_INSTALACION ?? '';

if (!CLAVE || !INSTALACION) {
  console.error('Faltan BINNY_TEST_CLAVE y BINNY_TEST_INSTALACION');
  process.exit(2);
}

const BLOQUES_AUTORIZADOS = new Set([
  'crear_producto', 'crear-producto', 'producto_crear',
  'crear_recordatorio', 'crear-recordatorio', 'recordatorio_crear',
  'crear_gasto', 'crear-gasto', 'gasto_crear',
  'cambiar_modulo', 'cambiar-modulo', 'modulos_sistema', 'activar_modulo',
  'crear_compra', 'crear-compra', 'compra_crear', 'orden_compra',
  'guardar_memoria', 'guardar-memoria', 'memoria_guardar', 'recordar_dato',
  'crear_proveedor', 'crear-proveedor', 'proveedor_crear', 'nuevo_proveedor',
  'chart', 'whatsapp', 'mensaje',
]);

interface Caso {
  nombre: string;
  pregunta: string;
  debeEmitir?: string;      // fence esperado (substring, ej: "crear_proveedor")
  jamasEmitir?: string[];   // fences prohibidos para este caso
  /** Turno previo simulado (entrevista multi-turno como el bug real). */
  turnoPrevio?: { pregunta: string; respuesta: string };
  /** La respuesta no debe contener disculpas del guardián (bug del reemplazo). */
  sinDisculpa?: boolean;
  /** Substrings que el texto final DEBE mencionar (insensible a mayúsculas). */
  debeMencionar?: string[];
  /** Substrings que el texto final NO debe contener (ej: backstop genérico). */
  textoProhibido?: string[];
  /** El texto final no debe contener JSON suelto de entidad (bug del combo). */
  sinJsonSuelto?: boolean;
  /** Una tool emitida debe traer cierto fragmento en sus argumentos (sin espacios). */
  toolArgsIncluye?: { tool: string; fragmento: string };
  /** Tools que el caso jamás debe usar (incluye ejecutar_consulta). */
  jamasTools?: string[];
  /** Techo de tokens de prompt acumulados en el ciclo (presupuesto de costo). */
  techoTokensCiclo?: number;
}

const CASOS: Caso[] = [
  {
    nombre: 'proveedor sin datos (bug original)',
    pregunta: '¿Podemos crear un nuevo proveedor? Se llama Importadora del Valle. No tengo más datos.',
    debeEmitir: 'crear_proveedor',
    jamasEmitir: ['crear_producto'],
  },
  {
    nombre: 'cliente (sin bloque dedicado)',
    pregunta: 'Dame de alta al cliente Juan Pérez, teléfono 3515551234.',
    jamasEmitir: ['crear_producto', 'crear_proveedor', 'crear_compra'],
  },
  {
    nombre: 'combo (sin bloque dedicado)',
    pregunta: 'Armame un combo de fideos con salsa para vender esta semana.',
    jamasEmitir: ['crear_producto', 'crear_proveedor'],
  },
  {
    nombre: 'aumento de precios (sin bloque dedicado)',
    pregunta: 'Aumentame un 10% los precios de todas las gaseosas.',
    jamasEmitir: ['crear_producto', 'crear_proveedor', 'cambiar_modulo'],
  },
  {
    nombre: 'pregunta de datos (flujo SQL normal)',
    pregunta: '¿Cuánto vendí hoy?',
  },
  {
    nombre: 'producto normal (sin regresión)',
    pregunta: 'Creá el producto Alfajor Jorgito, costo 800, venta 1500, stock 48, código ALF-JOR.',
    debeEmitir: 'crear_producto',
    jamasEmitir: ['crear_proveedor'],
  },
  {
    nombre: 'proveedor en 2 turnos (bug real del chat)',
    pregunta: 'Carlos SRL. No pongas ni el tel ni otras cosas.',
    turnoPrevio: {
      pregunta: 'Crea un proveedor',
      respuesta:
        '¡Claro! Para dar de alta un nuevo proveedor, necesito que me digas primero el nombre del proveedor. Los datos de contacto son opcionales.',
    },
    debeEmitir: 'crear_proveedor',
    jamasEmitir: ['crear_producto'],
  },
  {
    nombre: 'pregunta informativa sin datos (falso positivo del guardián)',
    pregunta: '¿Qué datos mínimos necesito para crear un producto?',
    jamasEmitir: ['crear_producto', 'crear_proveedor', 'crear_compra'],
    sinDisculpa: true,
  },
  {
    nombre: 'plan de reposición prioritaria (bug pasos agotados)',
    pregunta:
      'En mi inventario tengo 2 productos agotados y 0 bajo stock mínimo. Agotados destacados: "Pepsi lata 453cm3", "Pepsi lata 453cm3". Bajo stock destacados: ninguno. Consultá en la base de datos cuáles de estos artículos tienen mayor historial de ventas en los últimos 45 días. Armame una lista de pedido recomendada al proveedor priorizando los que más facturación aportan al negocio para no perder ventas.',
    debeMencionar: ['pepsi'],
    textoProhibido: ['más pasos de los disponibles'],
  },
  {
    nombre: 'orden de compra (Binny NO crea compras)',
    pregunta:
      'Preparame la orden de compra: 24 unidades de Leche Entera 1L a $1500 cada una y 12 de Azúcar 1kg a $900. El proveedor es Distribuidora Sur.',
    jamasEmitir: ['crear_compra', 'crear-compra', 'compra_crear', 'orden_compra'],
    debeMencionar: ['compra'],
    sinDisculpa: true,
  },
  {
    nombre: 'combo sugerido (JSON suelto prohibido)',
    pregunta:
      '¿Podríamos crear algún combo? Tengo Yerba Playadito 500g, Café Nescafé 500g y Galletitas Terrabusi parados. ¿Qué me sugerís?',
    jamasEmitir: ['crear_combo', 'combo', 'crear_producto'],
    debeMencionar: ['combo'],
    sinDisculpa: true,
    sinJsonSuelto: true,
  },
  {
    nombre: 'combo en 2 turnos (Binny NO crea combos)',
    pregunta: 'Prefiero la opción 1, vendilo a $3.500.',
    turnoPrevio: {
      pregunta: 'Preparemos un combo por acá, ¿qué sugerís?',
      respuesta:
        'Mirando tus ventas, tenés productos que se venden muy bien. Te sugiero el Combo "Dulce y Refrescante": Alfajores Havanna con Agua Cunningham. Si me decís a cuánto querés venderlo, te genero la ficha ahora mismo para confirmar en un clic.',
    },
    jamasEmitir: ['crear_producto', 'crear_proveedor', 'crear_combo', 'combo'],
    debeMencionar: ['combo'],
    sinDisculpa: true,
    sinJsonSuelto: true,
  },
  {
    nombre: 'memoria automática (dato de pasada)',
    pregunta: 'Ah, por cierto, mi proveedor de gaseosas es Distribuidora Sur, por si te sirve el dato.',
    debeEmitir: 'guardar_memoria',
    toolArgsIncluye: { tool: 'guardar_memoria', fragmento: '"automatico":true' },
    jamasEmitir: ['crear_producto', 'crear_proveedor'],
    sinDisculpa: true,
    sinJsonSuelto: true,
  },
  {
    nombre: 'cómo se hace (modo explicame)',
    pregunta: '¿Cómo hago un presupuesto para un cliente?',
    jamasTools: ['ejecutar_consulta'],
    jamasEmitir: ['crear_producto', 'crear_proveedor', 'crear_recordatorio', 'crear_gasto', 'cambiar_modulo', 'guardar_memoria'],
    debeMencionar: ['presupuesto'],
    sinDisculpa: true,
  },
  {
    nombre: 'simulador qué-pasa-si (cálculo delegado)',
    pregunta: 'Si subo 10% el precio de las gaseosas, ¿cuánto más facturaría por mes?',
    debeEmitir: 'simular_escenario',
    jamasEmitir: ['crear_producto', 'crear_proveedor'],
    debeMencionar: ['gaseosa'],
    sinDisculpa: true,
  },
  {
    nombre: 'informe completo 5 partes (techo de costo)',
    pregunta:
      'Haceme un informe completo y detallado de mi negocio: primero un resumen ejecutivo de mis ventas de los últimos 30 días con ticket promedio y comparación con el mes anterior; después el top 10 de mis productos más vendidos con cantidades y facturación de cada uno; después un análisis de qué productos no rotan hace más de 45 días y cuánto capital tengo inmovilizado; después quiénes son mis 5 clientes con más deuda y qué me recomendás hacer con cada uno; y para cerrar, dame un plan de acción concreto de 7 puntos para aumentar la facturación la próxima semana. Explayate en cada punto, no me des un resumen corto.',
    debeMencionar: ['venta', 'deuda', 'plan'],
    techoTokensCiclo: 180000,
    sinDisculpa: true,
    sinJsonSuelto: true,
  },
];

async function sse(url: string, body: unknown): Promise<Array<{ evt: string; data: any }>> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const eventos: Array<{ evt: string; data: any }> = [];
  let evt: string | null = null;
  let data = '';
  for await (const chunk of res.body as any) {
    for (const linea of Buffer.from(chunk).toString('utf8').split('\n')) {
      const t = linea.trim();
      if (t.startsWith('event:')) evt = t.slice(6).trim();
      else if (t.startsWith('data:')) data += t.slice(5).trim();
      else if (t === '' && evt) {
        eventos.push({ evt, data: JSON.parse(data || '{}') });
        evt = null;
        data = '';
      }
    }
  }
  return eventos;
}

function resultadoFalso(sql: string): string {
  const s = sql.toLowerCase();
  if (s.includes('proveedor')) return 'Tus datos: (0 resultados):\n[]\n\nNo existe ese proveedor todavía.';
  if (s.includes('venta_item')) return 'Tus datos: (2 resultados):\n[{"producto_nombre":"Pepsi lata 453cm3","unidades_45d":120,"facturacion_45d":180000},{"producto_nombre":"Coca 2L","unidades_45d":40,"facturacion_45d":100000}]\n\nAnalizá y respondé en español simple.';
  if (s.includes('venta') || s.includes('total')) return 'Tus datos: (1 resultados):\n[{"total_hoy": 87500, "tickets": 23}]\n\nAnalizá y respondé en español simple.';
  if (s.includes('deuda') || s.includes('cliente')) return 'Tus datos: (5 resultados):\n[{"nombre":"Almacén Don Pedro","saldo_actual":85000},{"nombre":"Kiosco La Esquina","saldo_actual":62000},{"nombre":"Mercadito Sur","saldo_actual":41000},{"nombre":"Despensa El Sol","saldo_actual":28000},{"nombre":"Autoservicio Norte","saldo_actual":15000}]\n\nAnalizá y respondé en español simple.';
  if (s.includes('producto')) return 'Tus datos: (3 resultados):\n[{"id":1,"nombre":"Coca 2L","precio_venta":2500,"precio_costo":1500,"cantidad":48},{"id":2,"nombre":"Sprite 2L","precio_venta":2400,"precio_costo":1400,"cantidad":0},{"id":3,"nombre":"Fanta 2L","precio_venta":2300,"precio_costo":1350,"cantidad":5}]\n\nAnalizá y respondé en español simple.';
  return 'Tus datos: (0 resultados):\n[]\n\nAnalizá y respondé en español simple.';
}

function fencesDe(texto: string): string[] {
  const out: string[] = [];
  const re = /```(\w[\w-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    if (m[1].toLowerCase() !== 'json') out.push(m[1]);
  }
  return out;
}

async function correrCaso(caso: Caso): Promise<{ ok: boolean; fallos: string[]; tokens: { prompt: number; completion: number; cached: number } }> {
  const fallos: string[] = [];
  const contexto = { usar_iva: false };
  // Tokens acumulados del ciclo (todas las llamadas LLM del caso): base del
  // reporte de costo y del techo por ciclo.
  const toks = { prompt: 0, completion: 0, cached: 0 };
  const sumarTokens = (evs: Array<{ evt: string; data: any }>) => {
    for (const e of evs) {
      if (e.evt !== 'done' || !e.data?.tokens) continue;
      toks.prompt += Number(e.data.tokens.prompt_tokens ?? 0);
      toks.completion += Number(e.data.tokens.completion_tokens ?? 0);
      toks.cached += Number(e.data.tokens.cached_tokens ?? 0);
    }
  };
  const historial: any[] = caso.turnoPrevio
    ? [
        { role: 'user', content: caso.turnoPrevio.pregunta },
        { role: 'assistant', content: caso.turnoPrevio.respuesta },
        { role: 'user', content: caso.pregunta },
      ]
    : [{ role: 'user', content: caso.pregunta }];
  const historialInicial = caso.turnoPrevio
    ? [
        { rol: 'usuario', contenido: caso.turnoPrevio.pregunta },
        { rol: 'asistente', contenido: caso.turnoPrevio.respuesta },
      ]
    : [];

  let ev = await sse(`${BASE}/api/chat/agente/stream`, {
    clave: CLAVE, instalacion_id: INSTALACION, pregunta: caso.pregunta, historial: historialInicial, contexto,
  });

  let textoFinal = '';
  // Etapa 2: cards también pueden llegar como tool calls nativos (no solo fences).
  const cardsPorTool: string[] = [];
  // Ítem 1: argumentos de las tools emitidas (para asserts como automatico:true).
  const herramientasConArgs: Array<{ nombre: string; args: string }> = [];
  // Loop del agente (igual que producción: 7 pasos, el backend fuerza el cierre)
  for (let paso = 0; paso < 7; paso++) {
    const tools = ev.filter((e) => e.evt === 'herramienta').flatMap((e) => e.data.tool_calls ?? []);
    // Etapa 2: cards nativas (cualquier tool que no sea ejecutar_consulta).
    for (const t of tools) {
      if (t.nombre && t.nombre !== 'ejecutar_consulta') cardsPorTool.push(String(t.nombre));
      if (t.nombre) herramientasConArgs.push({ nombre: String(t.nombre), args: String(t.argumentos ?? '') });
    }
    const done = ev.find((e) => e.evt === 'done');
    if (done?.data?.texto) textoFinal = done.data.texto;
    sumarTokens(ev);
    const err = ev.find((e) => e.evt === 'error');
    if (err) {
      fallos.push(`error del backend: ${err.data?.texto ?? ''}`);
      break;
    }
    if (tools.length === 0) break;
    historial.push({
      role: 'assistant', content: '',
      tool_calls: tools.map((t: any) => ({ id: t.id, type: 'function', function: { name: t.nombre, arguments: t.argumentos } })),
    });
    for (const t of tools) {
      if (t.nombre && t.nombre !== 'ejecutar_consulta') {
        // Como el desktop: la tarjeta se muestra, el loop continúa.
        // Ítem 3: simular_escenario devuelve cálculo local (igual que producción).
        if (String(t.nombre) === 'simular_escenario') {
          historial.push({
            role: 'tool',
            tool_call_id: t.id,
            content:
              'Resultado de la simulación (cálculo local exacto, ventas reales de 45 días):\n{"tipo":"precio","metrica":"facturacion","porcentaje":10,"filtro":"gaseosas","productos_analizados":3,"unidades_totales_45d":120,"total_actual_45d":180000,"total_simulado_45d":198000,"delta_45d":18000,"supuesto":"Volumen constante"}\n\nNarrá este resultado en español simple sin recalcular.',
          });
          continue;
        }
        // Ítem 1: guardar_memoria automática devuelve el contenido anotado
        // (igual que el desktop en producción), no el texto de tarjeta.
        let contenidoTool = 'Tarjeta mostrada al comerciante con esos datos. No la repitas ni la reemitas: continuá directamente con tu respuesta final en texto.';
        if (String(t.nombre) === 'guardar_memoria') {
          try {
            const a = JSON.parse(t.argumentos ?? '{}');
            if (a?.automatico === true && typeof a?.contenido === 'string' && a.contenido.trim()) {
              contenidoTool = `Dalo por anotado en tu memoria: ${a.contenido.trim()}. Avisale al comerciante con una frase corta, sin tarjeta.`;
            }
          } catch { /* args inválidos: respuesta genérica */ }
        }
        historial.push({ role: 'tool', tool_call_id: t.id, content: contenidoTool });
        continue;
      }
      let args: any = {};
      try { args = JSON.parse(t.argumentos ?? '{}'); } catch { /* tool malformado */ }
      historial.push({ role: 'tool', tool_call_id: t.id, content: resultadoFalso(String(args.sql ?? '')) });
    }
    ev = await sse(`${BASE}/api/chat/agente/continuar/stream`, {
      clave: CLAVE, instalacion_id: INSTALACION, contexto, historial,
    });
  }

  if (!textoFinal.trim() && fallos.length === 0) {
    // Cierre inteligente (igual que el desktop en producción): una última
    // llamada con todo lo acumulado pidiendo redacción final sin más consultas.
    historial.push({
      role: 'user',
      content:
        'Ya no podés hacer más consultas. Redactá AHORA la respuesta final al comerciante usando ÚNICAMENTE la información que ya obtuviste en este análisis. Si te falta algún dato, decilo con honestidad en vez de inventarlo.',
    });
    try {
      const evCierre = await sse(`${BASE}/api/chat/agente/continuar/stream`, {
        clave: CLAVE, instalacion_id: INSTALACION, contexto, historial,
      });
      const doneCierre = evCierre.find((e) => e.evt === 'done');
      sumarTokens(evCierre);
      if (doneCierre?.data?.texto?.trim()) {
        textoFinal = doneCierre.data.texto;
      } else {
        fallos.push('sin respuesta final tras cierre inteligente');
      }
    } catch (e) {
      fallos.push(`cierre inteligente falló: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Assert (a): fences dentro de la lista cerrada
  const fences = fencesDe(textoFinal);
  const normalizar = (f: string) => f.toLowerCase().replace(/[-_]/g, '');
  for (const f of fences) {
    if (!BLOQUES_AUTORIZADOS.has(f)) {
      fallos.push(`bloque no autorizado emitido: ${f}`);
    }
  }
  // Assert (b): sin deliberación visible (mismo detector de producción)
  const marcadores = detectarDeliberacion(textoFinal);
  if (marcadores.length > 0) {
    fallos.push(`deliberación visible: ${marcadores.join(' | ')}`);
  }
  // Assert (c): expectativas del caso (fence en texto O tool nativo).
  // Acepta variantes crear_proveedor/crear-proveedor/...
  const emitido = (nombre: string) =>
    fences.some((f) => normalizar(f) === normalizar(nombre)) ||
    cardsPorTool.some((c) => normalizar(c) === normalizar(nombre));
  if (caso.debeEmitir && !emitido(caso.debeEmitir)) {
    fallos.push(`no emitió lo esperado: ${caso.debeEmitir} (ni fence ni tool)`);
  }
  for (const prohibido of caso.jamasEmitir ?? []) {
    if (emitido(prohibido)) {
      fallos.push(`emitió lo prohibido: ${prohibido}`);
    }
  }
  // Assert (c2): fragmento esperado en los argumentos de una tool emitida.
  if (caso.toolArgsIncluye) {
    const { tool, fragmento } = caso.toolArgsIncluye;
    const fragNorm = fragmento.replace(/\s+/g, '');
    const hallada = herramientasConArgs.some(
      (h) => normalizar(h.nombre) === normalizar(tool) && h.args.replace(/\s+/g, '').includes(fragNorm),
    );
    if (!hallada) {
      fallos.push(`ninguna tool ${tool} trajo en sus argumentos: ${fragmento}`);
    }
  }
  // Assert (c3): tools jamás usadas en este caso (ej: modo explicame sin SQL).
  for (const t of caso.jamasTools ?? []) {
    if (herramientasConArgs.some((h) => normalizar(h.nombre) === normalizar(t))) {
      fallos.push(`usó la tool prohibida: ${t}`);
    }
  }
  // Assert (d): sin promesa falsa (mismo guardián de producción).
  // Solo aplica si NO hubo card por tool: con tool nativo no hay promesa rota.
  if (cardsPorTool.length === 0 && prometeSinTarjeta(textoFinal)) {
    fallos.push('promesa de tarjeta sin bloque emitido');
  }
  // Assert (e): sin disculpas del guardián (el reintento nunca debe reemplazar
  // una respuesta válida por "tienes toda la razón, disculpas...").
  if (caso.sinDisculpa && /disculp|toda la raz[óo]n|perd[óo]n por/i.test(textoFinal)) {
    fallos.push('respuesta reemplazada por disculpa del guardián');
  }
  // Assert (f): contenido esperado / genéricos prohibidos (ej: backstop de pasos).
  for (const m of caso.debeMencionar ?? []) {
    if (!textoFinal.toLowerCase().includes(m.toLowerCase())) {
      fallos.push(`no menciona lo esperado: ${m}`);
    }
  }
  for (const t of caso.textoProhibido ?? []) {
    if (textoFinal.toLowerCase().includes(t.toLowerCase())) {
      fallos.push(`contiene texto prohibido: ${t}`);
    }
  }
  // Assert (g): sin JSON suelto de entidad (mismo detector de producción).
  // Un objeto crudo con forma de combo/producto/etc. fuera de un fence es
  // la promesa fantasma del bug del combo: nunca debe llegar al usuario.
  if (caso.sinJsonSuelto) {
    const suelto = jsonSueltoEntidad(textoFinal);
    if (suelto) {
      fallos.push(`JSON suelto de entidad (${suelto.entidad}) en el texto final`);
    }
  }
  // Assert (h): techo de costo por ciclo (presupuesto aprobado por el dueño).
  if (caso.techoTokensCiclo !== undefined && toks.prompt > caso.techoTokensCiclo) {
    fallos.push(`ciclo excedió el techo de costo: ${toks.prompt} tokens de prompt > ${caso.techoTokensCiclo}`);
  }
  return { ok: fallos.length === 0, fallos, tokens: toks };
}

async function main() {
  let pass = 0;
  const costos: Array<{ nombre: string; ok: boolean; prompt: number; completion: number; cached: number }> = [];
  for (const caso of CASOS) {
    process.stdout.write(`\n[CASO] ${caso.nombre} ... `);
    try {
      const r = await correrCaso(caso);
      costos.push({ nombre: caso.nombre, ok: r.ok, ...r.tokens });
      if (r.ok) {
        pass++;
        console.log('✅ PASS');
      } else {
        console.log('❌ FAIL');
        for (const f of r.fallos) console.log(`       - ${f}`);
      }
    } catch (e) {
      console.log(`❌ ERROR: ${e instanceof Error ? e.message : e}`);
      costos.push({ nombre: caso.nombre, ok: false, prompt: 0, completion: 0, cached: 0 });
    }
  }
  console.log(`\n${pass}/${CASOS.length} casos OK`);
  // Reporte de costo de la corrida (precios verificados en chat.pricing.ts):
  // "hola" vs "informe completo" tienen costos muuuy diferentes; el promedio
  // por mensaje de usuario diluye ambos. Ver scripts/costo-mensaje.mts.
  const filas = costos.map((c) => ({ ...c, usd: costoUSD(c.prompt, c.completion, c.cached) }));
  console.log('\n--- Costo por caso (ciclo completo = 1 mensaje de usuario) ---');
  for (const f of filas) {
    console.log(`  ${f.ok ? '✅' : '❌'} ${f.nombre} — prompt=${f.prompt} salida=${f.completion} caché=${f.cached} → ${fmtUSD(f.usd)}`);
  }
  const tPrompt = filas.reduce((s, f) => s + f.prompt, 0);
  const tComp = filas.reduce((s, f) => s + f.completion, 0);
  const tCached = filas.reduce((s, f) => s + f.cached, 0);
  const ordenados = [...filas].map((f) => f.usd).sort((a, b) => a - b);
  const mediana = ordenados[Math.floor(ordenados.length / 2)] ?? 0;
  const p90 = ordenados[Math.min(ordenados.length - 1, Math.floor(ordenados.length * 0.9))] ?? 0;
  const max = ordenados[ordenados.length - 1] ?? 0;
  console.log(
    `--- Corrida: prompt=${tPrompt} salida=${tComp} caché=${tCached} → ${fmtUSD(costoUSD(tPrompt, tComp, tCached))}` +
      `  | por caso: mediana=${fmtUSD(mediana)} p90=${fmtUSD(p90)} máx=${fmtUSD(max)} ---`,
  );
  process.exit(pass === CASOS.length ? 0 : 1);
}

main().catch((e) => {
  console.error('Fallo la batería:', e);
  process.exit(1);
});
