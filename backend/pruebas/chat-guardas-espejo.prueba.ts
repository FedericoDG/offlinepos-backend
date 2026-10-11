/**
 * Pruebas del ESPEJO de guardas determinísticas de Binny
 * (`src/features/chat/chat.guardas.espejo.ts`).
 *
 *   npx tsx pruebas/chat-guardas-espejo.prueba.ts   (o vía pruebas/correr.ts)
 *
 * Son funciones PURAS: no tocan red ni base. Cubren oferta final, disculpa,
 * bloque SQL, sugerencias sueltas y texto normal intacto, más algunos bordes
 * (repregunta corta, decimales, bloques autorizados).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import './entorno';

import { igual, informe, prueba, seccion } from './ayuda';
import {
  aplicarGuardasEspejo,
  esMetaDisculpa,
  quitarBloquesTecnicos,
  quitarDisculpas,
  quitarOfertaFinal,
  tieneBloqueTecnico,
} from '../src/features/chat/chat.guardas.espejo';

export function correr(): void {
  // --- Oferta final ---------------------------------------------------------

  seccion('quitarOfertaFinal');

  {
    const conOferta =
      'Estos son tus productos más vendidos del mes:\n\n' +
      '| Producto | Unidades |\n| --- | --- |\n| Coca-Cola | 40 |\n| Yerba | 30 |\n\n' +
      'Coca-Cola lidera con 40 unidades. ¿Querés que te arme un plan de reposición?';
    const sinOferta = quitarOfertaFinal(conOferta);
    prueba('borra la pregunta de oferta final', !sinOferta.includes('¿Querés que te arme'));
    prueba('conserva el contenido (tabla y cifras)', sinOferta.includes('Coca-Cola lidera con 40 unidades.'));
  }

  {
    const repregunta = '¿Querés que te muestre de hoy, de la semana o del mes?';
    igual('no toca la repregunta corta de desambiguación', quitarOfertaFinal(repregunta), repregunta);
  }

  {
    const texto = 'Hoy vendiste $12.000 en 8 tickets.';
    igual('no toca un texto que termina afirmando', quitarOfertaFinal(texto), texto);
  }

  {
    // Ojo: la guarda solo actúa con contenido sustantivo (≥120 chars útiles o
    // tabla markdown); por eso el texto es largo a propósito.
    const ofertaYSeguir =
      'Hoy vendiste $45.000 en 12 tickets, un 16,9% más que ayer y el ticket promedio fue de $3.750, ' +
      'con Coca-Cola como el producto más vendido del día. ¿Querés que te muestre el detalle por producto?\n\n' +
      '```seguir\n¿Cómo viene la semana?\n¿Qué producto se vende más?\n```';
    const salida = quitarOfertaFinal(ofertaYSeguir);
    prueba(
      'borra la oferta pero conserva el bloque seguir',
      !salida.includes('¿Querés que te muestre el detalle') && salida.includes('```seguir'),
    );
  }

  // --- Disculpas ------------------------------------------------------------

  seccion('quitarDisculpas');

  {
    const conDisculpa =
      'Tienes razón, disculpá. No tenía los datos exactos. ' +
      'Este mes vendiste $120.000 en 40 tickets.';
    const limpio = quitarDisculpas(conDisculpa);
    prueba('borra las oraciones de disculpa', !esMetaDisculpa(limpio));
    prueba('conserva la respuesta con datos', limpio.includes('$120.000 en 40 tickets'));
  }

  {
    const texto = 'Hoy vendiste $12.000. Disculpá.';
    const limpio = quitarDisculpas(texto);
    prueba('no parte decimales ($12.000 intacto)', limpio.includes('$12.000'));
    prueba('borra la oración de disculpa suelta', !limpio.toLowerCase().includes('disculp'));
  }

  {
    const texto = 'Hoy vendiste $45.000 en 12 tickets.';
    igual('texto normal sin disculpas queda intacto', quitarDisculpas(texto), texto);
  }

  // --- Bloques técnicos -----------------------------------------------------

  seccion('quitarBloquesTecnicos');

  {
    const conSql =
      'Estas son tus ventas de hoy:\n\n```sql\nSELECT SUM(total) FROM venta WHERE creada_en > 0\n```\n\nTotal: $45.000 en 12 tickets.';
    const limpio = quitarBloquesTecnicos(conSql);
    prueba('elimina el bloque ```sql', !tieneBloqueTecnico(limpio));
    prueba('conserva la prosa con datos', limpio.includes('$45.000 en 12 tickets'));
  }

  {
    const conLineaSuelta =
      'Mirá el detalle:\n' +
      'SELECT v.id, v.total FROM venta v JOIN cliente c ON c.id = v.cliente_id ORDER BY v.total DESC\n' +
      'Total del día: $45.000.';
    const limpio = quitarBloquesTecnicos(conLineaSuelta);
    prueba('elimina una línea suelta que parece SQL', !tieneBloqueTecnico(limpio));
    prueba('conserva la línea de comerciante', limpio.includes('Total del día: $45.000'));
  }

  {
    const conChart = 'Ventas por día:\n\n```chart\n{"tipo":"barras"}\n```\n\nEl lunes fue el mejor día.';
    igual('NO toca bloques autorizados (chart)', quitarBloquesTecnicos(conChart), conChart);
  }

  {
    prueba('tieneBloqueTecnico detecta ```json', tieneBloqueTecnico('```json\n{"a":1}\n```'));
    prueba('tieneBloqueTecnico ignora ```seguir', !tieneBloqueTecnico('```seguir\n¿Cuánto vendí hoy?\n```'));
    prueba('tieneBloqueTecnico ignora prosa normal', !tieneBloqueTecnico('Hoy vendiste $12.000 en 8 tickets.'));
  }

  // --- Sugerencias sueltas (normalizarSeguir) -------------------------------

  seccion('normalizarSeguir (vía espejo)');

  {
    const sueltas =
      'Hoy vendiste $45.000 en 12 tickets.\n\n' +
      '¿Cuánto vendí la semana pasada?\n¿Qué producto se vende más?';
    const { texto } = aplicarGuardasEspejo(sueltas);
    prueba('envuelve el sufijo de 2 preguntas sueltas en ```seguir', texto.includes('```seguir'));
    prueba('conserva la respuesta principal', texto.includes('Hoy vendiste $45.000'));
  }

  // --- Texto normal intacto -------------------------------------------------

  seccion('texto normal intacto');

  {
    const normal = 'Hoy vendiste $45.000 en 12 tickets, un 16,9% más que ayer. Tu ticket promedio fue de $3.750.';
    const { texto, disparos } = aplicarGuardasEspejo(normal);
    igual('un texto limpio no se modifica', texto, normal);
    prueba(
      'ninguna guarda se dispara',
      !disparos.normalizarSeguir &&
        !disparos.quitarNombresInternos &&
        !disparos.quitarBloquesTecnicos &&
        !disparos.quitarOfertaFinal &&
        !disparos.quitarDisculpas,
    );
  }

  // --- Métrica de disparos --------------------------------------------------

  seccion('aplicarGuardasEspejo (disparos)');

  {
    const sucio =
      'Disculpá, me equivoqué.\n\n' +
      '```sql\nSELECT * FROM venta\n```\n\n' +
      'Hoy vendiste $45.000 en 12 tickets, un 16,9% más que ayer y el ticket promedio fue de $3.750, ' +
      'con Coca-Cola como el producto más vendido del día. ¿Querés que te arme un resumen?\n\n' +
      '¿Cómo viene la semana?\n¿Qué producto se vende más?';
    const { texto, disparos } = aplicarGuardasEspejo(sucio);
    prueba('dispara quitarBloquesTecnicos', disparos.quitarBloquesTecnicos);
    prueba('dispara quitarDisculpas', disparos.quitarDisculpas);
    prueba('dispara normalizarSeguir', disparos.normalizarSeguir);
    prueba('dispara quitarOfertaFinal', disparos.quitarOfertaFinal);
    prueba(
      'el texto final no filtra SQL ni disculpas',
      !texto.includes('SELECT') && !texto.toLowerCase().includes('disculp'),
    );
  }
}

// Ejecución directa: `npx tsx pruebas/chat-guardas-espejo.prueba.ts`.
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  correr();
  informe();
  // Importar `chat.service` deja handles abiertos (prisma): cerrar a mano.
  process.exit(process.exitCode ?? 0);
}
