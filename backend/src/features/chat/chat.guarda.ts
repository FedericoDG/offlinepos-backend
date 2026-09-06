const PALABRAS_PROHIBIDAS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|REPLACE|EXECUTE|INTO|VALUES|SET|TRUNCATE)\b/i;

/**
 * Normaliza el SQL: corrige LIMIT ausente o excesivo.
 * Retorna el SQL posiblemente modificado y si fue modificado.
 */
export function normalizarSQL(sql: string): { sql: string; modificado: boolean } {
  let trimmed = sql.trim();

  // Quitar punto y coma final
  if (trimmed.endsWith(';')) {
    trimmed = trimmed.slice(0, -1).trim();
  }

  let modificado = false;

  if (!/LIMIT\s+\d+/i.test(trimmed)) {
    // Sin LIMIT: agregar LIMIT 500
    trimmed = `${trimmed}\nLIMIT 500`;
    modificado = true;
  } else {
    // Con LIMIT > 500: clamp a 500
    trimmed = trimmed.replace(/LIMIT\s+(\d+)/i, (_match, num) => {
      if (parseInt(num, 10) > 500) {
        modificado = true;
        return 'LIMIT 500';
      }
      return `LIMIT ${num}`;
    });
  }

  if (modificado) {
    console.log('[Chat] SQL normalizado (LIMIT agregado o ajustado a 500)');
  }

  return { sql: trimmed, modificado };
}

export interface ResultadoValidacionSQL {
  valido: boolean;
  error?: string;
}

export function validarSQL(sql: string): ResultadoValidacionSQL {
  const trimmed = sql.trim();

  if (!trimmed) {
    return { valido: false, error: 'El SQL no puede estar vacío' };
  }

  const upper = trimmed.toUpperCase();

  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
    return { valido: false, error: 'Solo se permiten consultas SELECT o WITH' };
  }

  if (PALABRAS_PROHIBIDAS.test(trimmed)) {
    return { valido: false, error: 'El SQL contiene operaciones no permitidas (escritura/estructura)' };
  }

  const sinCadenas = trimmed.replace(/'[^']*'|"[^"]*"/g, '');
  const puntosComa = sinCadenas.split(';').filter((s) => s.trim().length > 0);
  if (puntosComa.length > 1) {
    return { valido: false, error: 'Solo se permite una sentencia SQL por consulta' };
  }

  // LIMIT siempre válido después de normalizar
  const limitMatch = trimmed.match(/LIMIT\s+(\d+)/i);
  if (limitMatch && parseInt(limitMatch[1], 10) > 500) {
    return { valido: false, error: 'El LIMIT no puede superar 500' };
  }

  return { valido: true };
}
