import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import AdmZip from 'adm-zip';
import { authenticateJWT, requireAdmin } from '../../middlewares/auth.middleware';
import prisma from '../../config/prisma';
import { handleApiError, httpError } from '../../utils/api-error';
import {
  ENCABEZADOS,
  parsearComercio,
  parsearProductos,
  parsearSucursales,
  validarEncabezado,
} from './parser';
import { importarDump, type ReporteImportacion } from './importar';

/**
 * Precios mayoristas (SEPA).
 *
 * El dueño sube, desde el panel, el ZIP con los tres CSV que publica cada
 * mayorista (`comercio.csv`, `sucursales.csv`, `productos.csv`).
 *
 * También acepta el **lote del día**: un ZIP que adentro trae los ZIP de varios
 * comercios (es como lo baja la mayoría). En ese caso se procesan todos y se
 * devuelve un reporte con cada uno.
 *
 * Solo admins: es data del sistema, no de un comercio.
 */
const router = Router();

router.use(authenticateJWT, requireAdmin);

/**
 * Los dumps van a memoria: uno de 20 MB se descomprime y se procesa en
 * segundos, y un lote completo (varios comercios) entra cómodo.
 */
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024, files: 1 },
});

/** Busca un archivo dentro de un ZIP por su nombre, sin importar la subcarpeta. */
function buscarEntrada(entradas: AdmZip.IZipEntry[], nombre: string) {
  const buscado = nombre.toLowerCase();
  return entradas.find(
    (e) => !e.isDirectory && path.basename(e.entryName).toLowerCase() === buscado,
  );
}

/** Los tres CSV que tiene que traer un dump. */
const ARCHIVOS_SEPA = ['comercio.csv', 'sucursales.csv', 'productos.csv'] as const;

/**
 * Procesa las entradas de UN dump (los tres CSV) y lo importa.
 *
 * Tira `httpError` con un mensaje que explica qué pasó si el formato no es el
 * esperado, si algún archivo viene vacío o si es otra versión del estándar.
 * Ese mensaje es lo que ve el dueño en el panel, así que dice el detalle.
 */
async function importarEntradas(entradas: AdmZip.IZipEntry[]): Promise<ReporteImportacion> {
  const faltantes = ARCHIVOS_SEPA.filter((nombre) => !buscarEntrada(entradas, nombre));
  if (faltantes.length > 0) {
    throw httpError(
      `Al ZIP le faltan archivos: ${faltantes.join(', ')}. ` +
        'Tiene que traer los tres CSV que publica el mayorista.',
      400,
    );
  }

  const texto = (nombre: string) =>
    buscarEntrada(entradas, nombre)!.getData().toString('utf8');

  const comercioCsv = texto('comercio.csv');
  const sucursalesCsv = texto('sucursales.csv');
  const productosCsv = texto('productos.csv');

  /**
   * Filas de datos reales: sin el encabezado ni las líneas vacías, y sin
   * contar la línea de pie (`última actualización: …`), que tiene un solo
   * campo y no es un dato.
   */
  const filasDeDatos = (contenido: string) =>
    contenido
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .slice(1)
      .filter((linea) => linea.trim().length > 0 && linea.split('|').length >= 5).length;

  /** Cuántas columnas trae el encabezado de un archivo. */
  const columnasDe = (contenido: string) =>
    (contenido.replace(/^\uFEFF/, '').split(/\r?\n/)[0] ?? '').split('|').length;

  /**
   * La versión del estándar SEPA que declara el dump (`comercio_version_sepa`,
   * el 8vo campo de la fila de comercio).
   */
  const versionDeclarada = (contenido: string): string | null => {
    const fila = contenido.replace(/^\uFEFF/, '').split(/\r?\n/)[1] ?? '';
    return fila.split('|')[7]?.trim() || null;
  };

  const archivos = [
    ['comercio.csv', comercioCsv, ENCABEZADOS.comercio],
    ['sucursales.csv', sucursalesCsv, ENCABEZADOS.sucursales],
    ['productos.csv', productosCsv, ENCABEZADOS.productos],
  ] as const;

  const conFormatoDistinto = archivos.filter(
    ([, contenido, esperado]) => !validarEncabezado(contenido, esperado),
  );

  if (conFormatoDistinto.length > 0) {
    const version = versionDeclarada(comercioCsv);
    const detalle = conFormatoDistinto
      .map(([nombre, contenido, esperado]) =>
        `${nombre} (trae ${columnasDe(contenido)} columnas y se esperaban ${columnasDe(esperado)})`,
      )
      .join(', ');

    // Un archivo que solo trae el encabezado merece decirlo aparte: el usuario
    // puede pensar que el problema es el formato cuando en realidad no hay
    // nada para importar.
    const vacios = conFormatoDistinto.filter(([, contenido]) => filasDeDatos(contenido) <= 0);
    const aclaracionVacio =
      vacios.length > 0
        ? ` Además, ${vacios.map(([n]) => n).join(' y ')} viene vacío (solo el encabezado).`
        : '';

    const aclaracionVersion = version
      ? ` El archivo declara la versión ${version} del estándar y el sistema lee la 0.`
      : '';

    throw httpError(
      `El formato de ${detalle} no es el que entiende el sistema. Pasa cuando el ` +
        `mayorista publica otra versión del estándar SEPA: las columnas cambian de ` +
        `nombre y de orden.${aclaracionVersion} No se importó nada.${aclaracionVacio}`,
      400,
    );
  }

  const comercio = parsearComercio(comercioCsv);
  const sucursales = parsearSucursales(sucursalesCsv);
  const productos = parsearProductos(productosCsv);

  if (comercio.items.length === 0) {
    throw httpError(
      'comercio.csv no tiene ninguna fila de comercio adentro (solo el encabezado o datos incompletos).',
      400,
    );
  }
  if (productos.items.length === 0) {
    throw httpError(
      'El ZIP trae productos.csv pero sin ningún producto adentro: no hay precios para importar.',
      400,
    );
  }

  return importarDump(prisma, {
    comercios: comercio.items,
    sucursales: sucursales.items,
    productos: productos.items,
    descartadas: comercio.descartadas + sucursales.descartadas + productos.descartadas,
  });
}

/**
 * Importa un dump, o un lote entero si el ZIP trae otros ZIP adentro.
 *
 * `POST /api/precios-mayoristas/importar` (multipart, campo `archivo`).
 */
router.post('/importar', subida.single('archivo'), async (req, res) => {
  const inicio = Date.now();
  try {
    if (!req.file) {
      throw httpError('Falta el archivo ZIP (campo "archivo")', 400);
    }

    let zip: AdmZip;
    try {
      zip = new AdmZip(req.file.buffer);
    } catch {
      throw httpError('El archivo no es un ZIP válido', 400);
    }

    const entradas = zip.getEntries();
    const traeLosCsv = ARCHIVOS_SEPA.every((nombre) => buscarEntrada(entradas, nombre));

    // Lote del día: un ZIP que adentro trae los ZIP de cada comercio. Es como
    // lo baja la mayoría, así que se procesa todo de una y se devuelve el
    // detalle de cada comercio (y de los que fallaron, con su motivo).
    if (!traeLosCsv) {
      const internos = entradas.filter(
        (e) => !e.isDirectory && e.entryName.toLowerCase().endsWith('.zip'),
      );

      if (internos.length > 0) {
        const cadenas: ReporteImportacion['cadenas'] = [];
        const omitidos: Array<{ archivo: string; motivo: string }> = [];

        for (const interno of internos) {
          try {
            const reporte = await importarEntradas(
              new AdmZip(interno.getData()).getEntries(),
            );
            cadenas.push(...reporte.cadenas);
          } catch (error: any) {
            omitidos.push({
              archivo: path.basename(interno.entryName),
              motivo: error?.message ?? 'no se pudo importar',
            });
          }
        }

        if (cadenas.length === 0) {
          throw httpError(
            `El ZIP trae ${internos.length} archivos adentro pero ninguno se pudo importar. ` +
              `Primer motivo: ${omitidos[0]?.motivo ?? 'desconocido'}`,
            400,
          );
        }

        return res.status(200).json({
          ok: true,
          cadenas,
          sucursales: cadenas.length,
          descartadas: 0,
          ms: Date.now() - inicio,
          archivos: internos.length,
          omitidos,
        });
      }

      // Ni CSV ni ZIPs adentro: el error de siempre, que ya explica qué falta.
      throw httpError(
        `Al ZIP le faltan archivos: ${['comercio.csv', 'sucursales.csv', 'productos.csv']
          .filter((nombre) => !buscarEntrada(entradas, nombre))
          .join(', ')}. ` +
          'Tiene que traer los tres CSV que publica el mayorista, o los ZIP de cada comercio.',
        400,
      );
    }

    const reporte = await importarEntradas(entradas);
    res.status(200).json({ ok: true, ...reporte, ms: Date.now() - inicio });
  } catch (error) {
    handleApiError(error, res, 'No se pudo importar el dump de precios');
  }
});

/** Cadenas cargadas, con su fecha y cuántos productos tiene cada una. */
router.get('/', async (_req, res) => {
  try {
    const cadenas = await prisma.cadena.findMany({
      orderBy: { bandera_nombre: 'asc' },
      include: {
        _count: { select: { precios: true, sucursales: true } },
      },
    });

    res.status(200).json({
      cadenas: cadenas.map((c) => ({
        id: c.id,
        cuit: c.cuit,
        razon_social: c.razon_social,
        bandera_nombre: c.bandera_nombre,
        bandera_url: c.bandera_url,
        actualizado_sepa_en: c.actualizado_sepa_en,
        importado_en: c.importado_en,
        productos: c._count.precios,
        sucursales: c._count.sucursales,
      })),
    });
  } catch (error) {
    handleApiError(error, res, 'No se pudieron listar las cadenas');
  }
});

/**
 * Productos de UNA cadena, paginados y con buscador.
 *
 * Es el detalle de la tabla del panel: 10.800 productos no se pueden mandar de
 * una, así que viene de a páginas y se puede filtrar por nombre o por código
 * de barras.
 */
router.get('/:id/productos', async (req, res) => {
  try {
    const cadena = await prisma.cadena.findUnique({ where: { id: req.params.id } });
    if (!cadena) throw httpError('La cadena no existe', 404);

    const pagina = Math.max(1, Number(req.query.pagina) || 1);
    const limite = Math.min(100, Math.max(5, Number(req.query.limite) || 25));
    const q = String(req.query.q ?? '').trim();

    // El buscador mira el nombre y el código de barras: son las dos formas en
    // que alguien busca un producto.
    const where: any = { cadena_id: cadena.id };
    if (q) {
      where.OR = [
        { descripcion: { contains: q, mode: 'insensitive' } },
        { marca: { contains: q, mode: 'insensitive' } },
        { ean: { contains: q } },
      ];
    }

    // El total se cuenta con el mismo `where`: si no, el paginador miente en
    // cuanto alguien escribe algo en el buscador.
    const [total, productos] = await Promise.all([
      prisma.precioMayorista.count({ where }),
      prisma.precioMayorista.findMany({
        where,
        orderBy: { descripcion: 'asc' },
        skip: (pagina - 1) * limite,
        take: limite,
      }),
    ]);

    res.status(200).json({
      cadena: {
        id: cadena.id,
        cuit: cadena.cuit,
        razon_social: cadena.razon_social,
        bandera_nombre: cadena.bandera_nombre,
        bandera_url: cadena.bandera_url,
        actualizado_sepa_en: cadena.actualizado_sepa_en,
        importado_en: cadena.importado_en,
      },
      datos: productos.map((p) => ({
        ean: p.ean,
        descripcion: p.descripcion,
        marca: p.marca,
        es_ean: p.es_ean,
        precio_con_iva: Number(p.precio_con_iva),
        precio_min: Number(p.precio_min),
        precio_max: Number(p.precio_max),
        sucursales: p.sucursales,
        importado_en: p.importado_en,
      })),
      total,
      pagina,
      limite,
      paginas: Math.max(1, Math.ceil(total / limite)),
    });
  } catch (error) {
    handleApiError(error, res, 'No se pudieron listar los productos de la cadena');
  }
});

/**
 * Borra TODAS las cadenas cargadas, con sus sucursales y sus precios.
 * Sirve para vaciar la sección y volver a empezar de cero.
 */
router.delete('/', async (_req, res) => {
  try {
    const { count } = await prisma.cadena.deleteMany({});

    res.status(200).json({
      ok: true,
      message:
        count === 0
          ? 'No había ninguna cadena cargada.'
          : `Se borraron ${count} ${count === 1 ? 'cadena' : 'cadenas'} con todos sus precios y sucursales.`,
    });
  } catch (error) {
    handleApiError(error, res, 'No se pudieron borrar las cadenas');
  }
});

/**
 * Borra UNA cadena completa. Sus precios y sucursales caen en cascada
 * (las relaciones están declaradas `onDelete: Cascade`).
 */
router.delete('/:id', async (req, res) => {
  try {
    const cadena = await prisma.cadena.findUnique({ where: { id: req.params.id } });
    if (!cadena) throw httpError('La cadena no existe', 404);

    await prisma.cadena.delete({ where: { id: cadena.id } });

    res.status(200).json({
      ok: true,
      message: `${cadena.bandera_nombre} se borró con todos sus precios y sucursales.`,
    });
  } catch (error) {
    handleApiError(error, res, 'No se pudo borrar la cadena');
  }
});

export default router;
