const PALABRAS_PROHIBIDAS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|REPLACE|EXECUTE|INTO|VALUES|SET|TRUNCATE)\b/i;
export function validarSQL(sql) {
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
    if (!/LIMIT\s+\d+/i.test(trimmed)) {
        return { valido: false, error: 'La consulta debe incluir una cláusula LIMIT' };
    }
    const limitMatch = trimmed.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
        const limit = parseInt(limitMatch[1], 10);
        if (limit > 500) {
            return { valido: false, error: 'El LIMIT no puede superar 500' };
        }
    }
    return { valido: true };
}
