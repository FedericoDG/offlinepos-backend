/**
 * Consulta de precios mayoristas disparada por el comando `/consultar-precio`.
 *
 * El comerciante escribe:
 *
 *   /consultar-precio quiero saber el precio de sal fina
 *   /consultar-precio decime el precio de coca cola 500 cm3
 *
 * y recibe los precios de lista de los mayoristas cargados.
 *
 * **No usa el modelo**: el tokenizador de `busqueda.ts` ya se queda con las
 * palabras útiles (saca "quiero", "saber", "el precio de"…), así que la
 * respuesta se arma con los datos de la base. Eso la hace instantánea, gratis
 * y —lo más importante— incapaz de inventar un precio.
 */

import type { ClientePrisma } from '../../config/prisma.tipos';
import {
  buscarPrecios,
  normalizar,
  type PrecioEncontrado,
  type ResultadoBusqueda,
} from './busqueda';

/** El comando que dispara esta consulta. */
export const COMANDO_PRECIO = '/consultar-precio';

/** ¿El mensaje es una consulta de precios mayoristas? */
export function esConsultaDePrecio(mensaje: string): boolean {
  return mensaje.trim().toLowerCase().startsWith(COMANDO_PRECIO);
}

/** Saca el comando y devuelve lo que el comerciante escribió después. */
export function textoDeConsulta(mensaje: string): string {
  return mensaje.trim().slice(COMANDO_PRECIO.length).trim();
}

/** Cómo mostrar el resultado. La tabla es el default; se puede pedir otro. */
export type FormatoSalida = 'tabla' | 'lista';

/**
 * Detecta si el comerciante pidió un formato distinto de la tabla. Solo hay
 * que reconocer el pedido: el default es la tabla, que se lee mejor.
 */
export function formatoPedido(consulta: string): FormatoSalida {
  const q = normalizar(consulta);
  if (/\b(lista|texto|plano|parrafo|whatsapp|wsp|wpp)\b/.test(q)) return 'lista';
  return 'tabla';
}

/** Precio en formato argentino: $3.015,01 */
function pesos(valor: number): string {
  return `$${valor.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** dd/mm/aaaa */
function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Agrupa las filas por producto: el mismo producto puede estar en varias cadenas. */
function agruparPorProducto(encontrados: PrecioEncontrado[]) {
  const porEan = new Map<string, { descripcion: string; cadenas: PrecioEncontrado[] }>();
  for (const e of encontrados) {
    const grupo = porEan.get(e.ean);
    if (grupo) grupo.cadenas.push(e);
    else porEan.set(e.ean, { descripcion: e.descripcion, cadenas: [e] });
  }
  // La cadena más barata primero: es lo que el comerciante quiere saber.
  for (const grupo of porEan.values()) {
    grupo.cadenas.sort((a, b) => a.precio_con_iva - b.precio_con_iva);
  }
  return [...porEan.values()];
}

/** La línea de precio de una cadena, igual en tabla y en lista. */
function rangoDe(c: PrecioEncontrado): string {
  const sucursales = c.sucursales === 1 ? '1 sucursal' : `${c.sucursales} sucursales`;

  // Si el precio varía, se muestra la franja (calculada sin las sucursales que
  // publican un precio absurdo). Y si hubo de esas, se dice: es honesto y
  // explica por qué la franja no las incluye.
  const franja =
    c.precio_max > c.precio_min
      ? `entre ${pesos(c.precio_min)} y ${pesos(c.precio_max)} en ${sucursales}`
      : sucursales;

  const atipicas =
    c.sucursales_atipicas > 0
      ? ` · ${c.sucursales_atipicas} ${
          c.sucursales_atipicas === 1 ? 'sucursal publica' : 'sucursales publican'
        } un precio muy distinto`
      : '';

  return `${pesos(c.precio_con_iva)} (${franja}${atipicas})`;
}

/**
 * Arma la respuesta en texto. Es determinística a propósito: los precios salen
 * de la base tal cual, sin que ningún modelo los reescriba.
 *
 * El default es **tabla** porque se lee mejor; si el comerciante pidió lista (o
 * WhatsApp), se devuelve en viñetas.
 */
export function formatearRespuesta(
  resultado: ResultadoBusqueda,
  formato: FormatoSalida = 'tabla',
): string {
  const consulta = resultado.consulta.trim();

  if (resultado.encontrados.length === 0) {
    return [
      `No encontré **${consulta}** entre los precios mayoristas cargados.`,
      '',
      'Probá con menos palabras: el nombre y la marca alcanzan (ej. *"sal fina"*, *"coca cola 500"*).',
    ].join('\n');
  }

  const grupos = agruparPorProducto(resultado.encontrados).slice(0, 12);
  const filasMostradas = grupos.reduce((suma, g) => suma + g.cadenas.length, 0);
  const hayMas = resultado.total > filasMostradas;
  const fecha = fechaCorta(resultado.encontrados[0].fecha_precio);

  const lineas: string[] = [];
  lineas.push(`### Precios **mayoristas** — ${consulta}`);
  if (fecha) {
    lineas.push(`_Precios de lista de los mayoristas, con IVA · actualizados al ${fecha}._`);
  }
  lineas.push('');

  if (resultado.dudoso) {
    lineas.push(`No estoy seguro de que sea lo que buscás. Esto es lo más parecido:`);
    lineas.push('');
  } else if (hayMas) {
    // Nunca mostrar un recorte en silencio: si hay más, se dice.
    lineas.push(
      `Hay **${resultado.total.toLocaleString('es-AR')} productos** que coinciden. ` +
        `Acá van los **${filasMostradas}** más relevantes:`,
    );
    lineas.push('');
  }

  if (formato === 'tabla') {
    lineas.push('| Producto | Mayorista | Precio |');
    lineas.push('|---|---|---|');
    for (const grupo of grupos) {
      for (const c of grupo.cadenas) {
        lineas.push(`| ${grupo.descripcion} | ${c.cadena} | ${rangoDe(c)} |`);
      }
    }
  } else {
    for (const grupo of grupos) {
      lineas.push(`**${grupo.descripcion}**`);
      for (const c of grupo.cadenas) {
        lineas.push(`· ${c.cadena} — ${rangoDe(c)}`);
      }
      lineas.push('');
    }
  }

  lineas.push('');
  if (hayMas) {
    lineas.push(
      '_Para afinar, agregá la **medida** (500 ml, 1,5 L, 2,25 L), la **variante** ' +
        '(light, zero, sin azúcar) o el **código de barras**._',
    );
  } else {
    lineas.push(
      grupos.length > 1
        ? '_El primero de cada producto es el más barato. Si querés verlo como lista, pedímelo._'
        : '_Si querés verlo como lista, pedímelo._',
    );
  }

  return lineas.join('\n').trim();
}

/** Corre la consulta completa: busca y arma la respuesta. */
export async function responderConsultaDePrecio(
  db: ClientePrisma,
  mensaje: string,
): Promise<string> {
  const consulta = textoDeConsulta(mensaje);
  // Se piden más filas que las que se muestran: un mismo producto puede estar
  // en varias cadenas y así el recorte no deja afuera a un mayorista.
  const resultado = await buscarPrecios(db, consulta, { limite: 30 });
  return formatearRespuesta({ ...resultado, consulta }, formatoPedido(consulta));
}
