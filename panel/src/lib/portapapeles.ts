/**
 * Copia texto al portapapeles en cualquier contexto.
 *
 * `navigator.clipboard` solo existe en contextos seguros (HTTPS o `localhost`).
 * Si el panel se abre por HTTP desde otra máquina de la red (por ejemplo
 * `http://192.168.1.50:3000/admin`), la API no está y el copiado fallaba en
 * silencio. El fallback con `execCommand` funciona en cualquier origen y sigue
 * siendo el camino de los navegadores que no exponen la API moderna.
 *
 * Devuelve `false` solo si ningún mecanismo pudo copiar: el llamador decide
 * cómo avisar, para que el botón nunca falle mudo.
 */
export async function copiarTexto(texto: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      // Permiso denegado o documento sin foco: se intenta el fallback.
    }
  }

  if (typeof document === 'undefined') return false;

  const area = document.createElement('textarea');
  area.value = texto;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '0';
  area.style.opacity = '0';
  document.body.appendChild(area);
  try {
    area.focus();
    area.select();
    area.setSelectionRange(0, area.value.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}
