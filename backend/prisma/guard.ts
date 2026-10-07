/**
 * Guarda para operaciones destructivas de base de datos (seed / reset).
 *
 * Regla: en producción (o contra una base que NO es local) la operación se
 * ABORTA salvo confirmación explícita. En desarrollo local corre normal.
 *
 * Confirmación explícita = las dos variables juntas:
 *   SEED_FORCE=1
 *   SEED_CONFIRM=<nombre exacto de la base>   (ej. pos_panel)
 *
 * El nombre se compara contra el path de DATABASE_URL, así que no alcanza con
 * copiar y pegar un comando: hay que saber qué base se está por borrar.
 */
export function exigirPermisoDestructivo(accion: string): void {
  const url = process.env.DATABASE_URL ?? '';

  let nombreBase = '?';
  let host = '?';
  try {
    const parsed = new URL(url);
    nombreBase = parsed.pathname.replace(/^\//, '') || '?';
    host = parsed.hostname || '?';
  } catch {
    /* URL ausente o inválida: se reporta como '?' y se pide confirmación. */
  }

  const esLocal = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(host);
  const esProduccion = process.env.NODE_ENV === 'production';

  // Camino feliz: desarrollo contra una base local. Nada que confirmar.
  if (!esProduccion && esLocal) {
    console.log(`[seed] ${accion} sobre "${nombreBase}" en ${host} (desarrollo).`);
    return;
  }

  const forzado = process.env.SEED_FORCE === '1';
  const confirmacion = process.env.SEED_CONFIRM ?? '';

  if (forzado && confirmacion === nombreBase) {
    console.log(`[seed] ${accion} CONFIRMADA sobre "${nombreBase}" en ${host}.`);
    return;
  }

  console.error(
    [
      '',
      '╔══════════════════════════════════════════════════════════════════╗',
      '║  OPERACIÓN DESTRUCTIVA BLOQUEADA                                 ║',
      '╚══════════════════════════════════════════════════════════════════╝',
      `  Acción : ${accion}`,
      `  Base   : "${nombreBase}" en ${host}`,
      esProduccion ? '  Motivo : NODE_ENV=production' : '  Motivo : la base no es local',
      '',
      '  Esto VACÍA la base de datos. Si es lo que querés, corré:',
      '',
      `    SEED_FORCE=1 SEED_CONFIRM=${nombreBase} npm run <script>`,
      '',
      '  En desarrollo local (base en localhost) no hace falta nada de esto.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
