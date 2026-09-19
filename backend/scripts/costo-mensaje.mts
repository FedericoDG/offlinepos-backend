/**
 * Costo promedio REAL por mensaje de usuario (ciclo completo) en USD.
 *
 * Clave: 1 mensaje del usuario en el chat = 1 ciclo = 1..N llamadas al LLM.
 * ChatConsumo acumula TODAS las llamadas del ciclo, y `mensajes` cuenta
 * ciclos — así que el promedio sale con datos reales, no a ojo.
 *
 * Precios: chat.pricing.ts (qwen3.7-flash, verificado 2026-09-14).
 * Referencia del usuario: $0.00056/mensaje (estimación manual previa).
 *
 * Uso: npx tsx scripts/costo-mensaje.mts
 * Solo lectura: no escribe nada en la base.
 */
import { PrismaClient } from '@prisma/client';
import { costoUSD, fmtUSD, PRECIOS_USD_POR_1M } from '../src/features/chat/chat.pricing';

const REFERENCIA_USUARIO = 0.00056;

const prisma = new PrismaClient();

async function main() {
  const filas = await prisma.chatConsumo.findMany({ orderBy: { periodo: 'asc' } });
  if (filas.length === 0) {
    console.log('Sin datos de consumo todavía.');
    return;
  }
  console.log(`Modelo: ${PRECIOS_USD_POR_1M.modelo}  (entrada $${PRECIOS_USD_POR_1M.entrada}/1M, caché $${PRECIOS_USD_POR_1M.entradaCacheada}/1M, salida $${PRECIOS_USD_POR_1M.salida}/1M)\n`);

  let tMsgs = 0n;
  let tPrompt = 0n;
  let tComp = 0n;
  let tCached = 0n;
  for (const r of filas) {
    const msgs = BigInt(r.mensajes);
    if (msgs === 0n) continue;
    const p = BigInt(r.prompt_tokens);
    const c = BigInt(r.completion_tokens);
    const ch = BigInt(r.cached_tokens);
    const pNum = Number(p);
    const cNum = Number(c);
    const chNum = Number(ch);
    const msgsNum = Number(msgs);
    const costo = costoUSD(pNum, cNum, chNum);
    const porMsg = costo / msgsNum;
    console.log(
      `${r.periodo}  mensajes=${msgs}` +
        `  prompt/msg=${Math.round(pNum / msgsNum)}` +
        ` (caché ${Math.round((chNum / Math.max(1, pNum)) * 100)}%)` +
        `  salida/msg=${Math.round(cNum / msgsNum)}` +
        `  costo/msg=${fmtUSD(porMsg)}  total=${fmtUSD(costo)}`,
    );
    tMsgs += msgs;
    tPrompt += p;
    tComp += c;
    tCached += ch;
  }
  if (tMsgs === 0n) return;
  const tPromptNum = Number(tPrompt);
  const tCompNum = Number(tComp);
  const tCachedNum = Number(tCached);
  const tMsgsNum = Number(tMsgs);
  const costoTotal = costoUSD(tPromptNum, tCompNum, tCachedNum);
  const promedio = costoTotal / tMsgsNum;
  console.log(
    `\nAGREGADO  mensajes=${tMsgs}` +
      `  prompt/msg=${Math.round(tPromptNum / tMsgsNum)}` +
      `  salida/msg=${Math.round(tCompNum / tMsgsNum)}` +
      `\nCosto promedio por mensaje de usuario: ${fmtUSD(promedio)}` +
      `  (referencia manual: $${REFERENCIA_USUARIO.toFixed(5)} → ${promedio <= REFERENCIA_USUARIO ? 'por DEBAJO' : 'por ENCIMA'})` +
      `\nCosto total acumulado: ${fmtUSD(costoTotal)}`,
  );
}

main()
  .catch((e) => {
    console.error('Fallo costo-mensaje:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
