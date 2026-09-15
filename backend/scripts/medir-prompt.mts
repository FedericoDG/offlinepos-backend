/**
 * Medidor + techo del tamaño del prompt por modo (Ítem 0: anti-alucinación).
 *
 * El prompt del agente viaja en CADA paso del ciclo: su tamaño impacta costo,
 * latencia y (lo más importante) obediencia del modelo. Este script imprime
 * el tamaño por modo y falla si el modo 'agente' supera el techo, para que el
 * prompt no vuelva a crecer sin querer.
 *
 * Uso: npx tsx scripts/medir-prompt.mts
 */
import { construirPromptSistema } from '../src/features/chat/chat.service';

const MODULOS_TODOS = {
  usar_marca: true, usar_categoria: true, categoria_multiple: false,
  usar_presentaciones: true, usar_iva: false, usar_proveedor: true,
  usar_gastos: true, usar_clientes: true, usar_presupuestos: true,
  usar_combos: true, usar_promociones: true, usar_vencimientos: true,
  usar_etiquetas: true, usar_recargos: true, usar_recordatorios: true,
  usar_balanza: false,
};
const MODULOS_MINIMOS = {
  ...MODULOS_TODOS,
  usar_gastos: false, usar_recordatorios: false, usar_proveedor: false,
};

const ctxFull = { usar_iva: false, modulos_activos: MODULOS_TODOS } as any;
const ctxMin = { usar_iva: false, modulos_activos: MODULOS_MINIMOS } as any;

const modos = ['json', 'stream', 'fase1', 'agente', 'brief', 'informe'] as const;
// Techo del modo agente con todo activo (~12k tokens ÷ 4 chars/token).
// Si el prompt crece más allá, hay que recortar o condicionar por módulo.
const TECHO_AGENTE_CHARS = 48000;

let fallo = false;
for (const modo of modos) {
  const full = construirPromptSistema(modo, ctxFull).length;
  const min = construirPromptSistema(modo, ctxMin).length;
  const marca = modo === 'agente' && full > TECHO_AGENTE_CHARS ? ' ❌ SUPERA TECHO' : '';
  if (marca) fallo = true;
  console.log(
    `${modo.padEnd(8)} full=${String(full).padStart(6)} (~${Math.round(full / 4)} tok)` +
    `  min=${String(min).padStart(6)} (~${Math.round(min / 4)} tok)  ahorro=${full - min}${marca}`,
  );
}
process.exit(fallo ? 1 : 0);
