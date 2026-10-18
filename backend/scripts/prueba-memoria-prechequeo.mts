/**
 * Tests de la función PURA `mensajePareceMemorable` (M2 latencia).
 *
 * Es el pre-chequeo determinista que decide si vale la pena disparar la llamada
 * automática de memoria (`forzarHerramienta: 'guardar_memoria'`) en un turno.
 * Sin red, sin DB, sin licencia: solo texto → booleano.
 *
 * Uso: npx tsx scripts/prueba-memoria-prechequeo.mts
 * Exit 1 si algún caso no coincide con lo esperado.
 */
import '../pruebas/entorno';
import { mensajePareceMemorable } from '../src/features/chat/chat.service';

interface Caso {
  texto: string;
  esperado: boolean;
  nota: string;
}

// --- Positivos: preferencias y datos estables (deben disparar) ---
const POSITIVOS: Caso[] = [
  { texto: 'acordate que mi proveedor es Lácteos del Sur', esperado: true, nota: 'marca explícita + hecho' },
  { texto: 'recordá que cobro con débito', esperado: true, nota: 'recordá' },
  { texto: 'anotá que el Fernet es el más vendido', esperado: true, nota: 'anotá' },
  { texto: 'tenés que saber que cierro los domingos', esperado: true, nota: 'tenés que saber' },
  { texto: 'ojo con los vencimientos de lácteos', esperado: true, nota: 'ojo con' },
  { texto: 'de ahora en más facturo en A', esperado: true, nota: 'de ahora en más' },
  { texto: 'a partir de mañana abrimos a las 8', esperado: true, nota: 'a partir de' },
  { texto: 'siempre trabajo con Lácteos del Sur', esperado: true, nota: 'siempre' },
  { texto: 'nunca vendo por debajo del costo', esperado: true, nota: 'nunca' },
  { texto: 'me gusta cobrar con transferencia', esperado: true, nota: 'me gusta' },
  { texto: 'no me gusta dar fiado', esperado: true, nota: 'no me gusta' },
  { texto: 'prefiero cobrar con débito', esperado: true, nota: 'prefiero' },
  { texto: 'preferimos facturar en A', esperado: true, nota: 'preferimos' },
  { texto: 'usamos código de barras', esperado: true, nota: 'usamos' },
  { texto: 'trabajo con Lácteos del Sur', esperado: true, nota: 'trabajo con' },
  { texto: 'mi proveedor es Distribuidora Norte', esperado: true, nota: 'mi + hecho' },
  { texto: 'mis clientes mayoristas pagan a 30 días', esperado: true, nota: 'mis ' },
  { texto: 'nuestro horario es de 9 a 18', esperado: true, nota: 'nuestro' },
  { texto: 'nuestra especialidad son las tortas', esperado: true, nota: 'nuestra' },
  { texto: 'abrimos de 9 a 18', esperado: true, nota: 'patrón histórico (hecho)' },
];

// --- Negativos: preguntas de datos, guías y pedidos (NO deben disparar) ---
const NEGATIVOS: Caso[] = [
  { texto: '¿Cuánto vendí hoy?', esperado: false, nota: 'dato' },
  { texto: '¿Cuánto vendí este mes?', esperado: false, nota: 'dato' },
  { texto: '¿Cómo creo un combo?', esperado: false, nota: 'guía' },
  { texto: '¿Cómo cargo una compra?', esperado: false, nota: 'guía' },
  { texto: 'Cargame un gasto de 5000 de luz', esperado: false, nota: 'pedido' },
  { texto: 'Creame un producto que se llame Prueba, costo 100 venta 200', esperado: false, nota: 'pedido' },
  { texto: 'Activame el módulo de combos vos', esperado: false, nota: 'pedido' },
  { texto: 'Mostrame los gastos del mes por categoría', esperado: false, nota: 'pedido con "mis"-like' },
  { texto: 'Mostrame mis ventas', esperado: false, nota: 'pedido + mis' },
  { texto: '¿Cómo se movieron mis ventas día por día esta semana?', esperado: false, nota: 'pregunta + mis' },
  { texto: '¿Cuáles fueron mis 5 productos más vendidos?', esperado: false, nota: 'pregunta + mis' },
  { texto: '¿Qué productos tengo con stock bajo?', esperado: false, nota: 'dato' },
  { texto: '¿Quiénes me deben plata?', esperado: false, nota: 'dato' },
  { texto: 'con esos datos puedes armarme un mensaje de whatsapp?', esperado: false, nota: 'pedido/seguimiento' },
  { texto: 'ok', esperado: false, nota: 'muy corto' },
  { texto: '', esperado: false, nota: 'vacío' },
];

function main() {
  const todos = [...POSITIVOS, ...NEGATIVOS];
  let fallas = 0;
  for (const caso of todos) {
    const obtenido = mensajePareceMemorable(caso.texto);
    const ok = obtenido === caso.esperado;
    if (!ok) fallas++;
    const marca = ok ? '✓' : '✗';
    const etiqueta = caso.esperado ? 'memorable' : 'no memorable';
    console.log(`${marca} [${etiqueta}] ${JSON.stringify(caso.texto)} → ${obtenido} (${caso.nota})`);
  }
  console.log(
    `\n${todos.length - fallas}/${todos.length} casos OK (positivos: ${POSITIVOS.length}, negativos: ${NEGATIVOS.length})`,
  );
  if (fallas > 0) {
    console.error(`\n❌ Pre-chequeo de memoria: FALLIDO (${fallas} desvío/s)`);
    process.exit(1);
  }
  console.log('\n✅ Pre-chequeo de memoria: EXITOSO');
  // process.exit explícito: importar chat.service registra un setInterval que
  // mantiene vivo el event loop.
  process.exit(0);
}

main();
