import { Router, type Request } from 'express';
import prisma from '../../config/prisma';
import { handleApiError, httpError } from '../../utils/api-error';
import { validarLicenciaChat } from '../chat/chat.service';
import { buscarPrecios } from './busqueda';
import { sucursalesDeProducto } from './sucursales';

/**
 * Búsqueda de precios mayoristas, para el POS.
 *
 * Va en su propio router —y no en `precios.routes.ts`— por una razón concreta:
 * el panel se maneja con sesión de admin, y el POS no tiene sesión: se
 * identifica con la licencia y la instalación activada, igual que el chat.
 *
 * No consume cuota del asistente: es una consulta a nuestra propia base, no una
 * llamada al modelo.
 */
const router = Router();

/** Lo que ve el POS de cada producto. Nada de campos internos ni de Prisma. */
interface FilaPrecio {
  ean: string;
  descripcion: string;
  marca: string | null;
  es_ean: boolean;
  precio_con_iva: number;
  precio_min: number;
  precio_max: number;
  sucursales: number;
  sucursales_atipicas: number;
  cadena: string;
  /** Id de la cadena: con el EAN identifican el producto para pedir el detalle. */
  cadena_id: string;
  fecha_precio: string;
}

/**
 * Valida la licencia del POS (clave + instalación activada). Es el mismo camino
 * que usa el chat: sin sesión de admin, pero con la instalación verificada.
 */
async function validarLicenciaDelPos(req: Request): Promise<void> {
  const clave = String(req.body?.clave ?? '').trim();
  const instalacionId = String(req.body?.instalacion_id ?? '').trim();

  if (!clave || !instalacionId) {
    throw httpError('Faltan la clave de licencia o el id de la instalación', 400);
  }

  await validarLicenciaChat(clave, instalacionId);
}

router.post('/buscar', async (req, res) => {
  try {
    await validarLicenciaDelPos(req);

    const q = String(req.body?.q ?? '').trim();
    // Menos de 3 letras traería medio catálogo y no le sirve a nadie.
    if (q.length < 3) {
      throw httpError('Escribí al menos 3 letras para buscar', 400);
    }

    const resultado = await buscarPrecios(prisma, q, {
      pagina: Number(req.body?.pagina) || 1,
      limite: Number(req.body?.limite) || 25,
    });

    const datos: FilaPrecio[] = resultado.encontrados.map((e) => ({
      ean: e.ean,
      descripcion: e.descripcion,
      marca: e.marca,
      es_ean: e.es_ean,
      precio_con_iva: e.precio_con_iva,
      precio_min: e.precio_min,
      precio_max: e.precio_max,
      sucursales: e.sucursales,
      sucursales_atipicas: e.sucursales_atipicas,
      cadena: e.cadena,
      cadena_id: e.cadena_id,
      fecha_precio: e.fecha_precio,
    }));

    // Los dumps de cada cadena se importan en días distintos, así que la fecha
    // que se muestra es la más reciente de lo que se está viendo. Decir una
    // sola fecha global sería mentir por abajo.
    const actualizado = datos.reduce<string | null>(
      (max, d) => (max === null || d.fecha_precio > max ? d.fecha_precio : max),
      null,
    );

    res.status(200).json({
      ok: true,
      consulta: resultado.consulta,
      datos,
      total: resultado.total,
      pagina: resultado.pagina,
      limite: resultado.limite,
      paginas: Math.max(1, Math.ceil(resultado.total / resultado.limite)),
      /** `true` = no se encontró con todos los términos y se aflojó a alguno. */
      aproximado: resultado.aproximado,
      actualizado,
    });
  } catch (error) {
    handleApiError(error, res, 'No se pudieron buscar los precios mayoristas');
  }
});

/**
 * El detalle de UN producto: a cuánto está en cada sucursal de esa cadena, con
 * la dirección de cada una, de la más barata a la más cara.
 *
 * Va aparte del buscador a propósito: la lista trae 25 productos y pedir el
 * detalle de cada uno sería pagar 25 veces por un dato que el comerciante mira
 * recién cuando un producto le interesa.
 */
router.post('/sucursales', async (req, res) => {
  try {
    await validarLicenciaDelPos(req);

    // Juntos identifican el producto: el mismo EAN existe en varias cadenas.
    const cadenaId = String(req.body?.cadena_id ?? '').trim();
    const ean = String(req.body?.ean ?? '').trim();
    if (!cadenaId || !ean) {
      throw httpError('Falta la cadena o el producto', 400);
    }

    const detalle = await sucursalesDeProducto(prisma, cadenaId, ean);
    if (!detalle) {
      throw httpError('No encontramos ese producto en esa cadena', 404);
    }

    res.status(200).json({ ok: true, ...detalle });
  } catch (error) {
    handleApiError(error, res, 'No se pudieron traer las sucursales del producto');
  }
});

export default router;
