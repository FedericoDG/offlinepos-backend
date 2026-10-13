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
import { importarDump } from './importar';

/**
 * Precios mayoristas (SEPA).
 *
 * El dueño sube, desde el panel, un ZIP con los tres CSV que publica cada
 * mayorista (`comercio.csv`, `sucursales.csv`, `productos.csv`). Acá se
 * descomprime, se valida el formato y se guarda con upsert.
 *
 * Solo admins: es data del sistema, no de un comercio.
 */
const router = Router();

router.use(authenticateJWT, requireAdmin);

/**
 * El ZIP va a memoria: un dump de 20 MB se descomprime y se procesa en
 * segundos, no hace falta tocar el disco.
 */
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 120 * 1024 * 1024, files: 1 },
});

/** Busca un archivo dentro del ZIP por su nombre, sin importar la subcarpeta. */
function buscarEntrada(entradas: AdmZip.IZipEntry[], nombre: string) {
  const buscado = nombre.toLowerCase();
  return entradas.find(
    (e) => !e.isDirectory && path.basename(e.entryName).toLowerCase() === buscado,
  );
}

/**
 * Importa un dump: `POST /api/precios-mayoristas/importar` (multipart, campo
 * `archivo`). Devuelve el reporte de lo que se creó y actualizó.
 */
router.post('/importar', subida.single('archivo'), async (req, res) => {
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
    const faltantes = ['comercio.csv', 'sucursales.csv', 'productos.csv'].filter(
      (nombre) => !buscarEntrada(entradas, nombre),
    );
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

    // Validar el encabezado antes de parsear. El mensaje tiene que decir QUÉ
    // cambió: mandar al usuario a comparar encabezados a mano no sirve, y este
    // caso ya nos pasó (un comercio publica otra versión del estándar SEPA,
    // con las columnas con otros nombres y en otro orden).
    const archivos = [
      ['comercio.csv', comercioCsv, ENCABEZADOS.comercio],
      ['sucursales.csv', sucursalesCsv, ENCABEZADOS.sucursales],
      ['productos.csv', productosCsv, ENCABEZADOS.productos],
    ] as const;

    const conFormatoDistinto = archivos.filter(
      ([, contenido, esperado]) => !validarEncabezado(contenido, esperado),
    );

    /**
     * La versión del estándar SEPA que declara el dump (`comercio_version_sepa`,
     * el 8vo campo de la fila de comercio). Sirve para que el mensaje de error
     * diga con qué versión nos encontramos y no solo "el formato cambió".
     */
    const versionDeclarada = (contenido: string): string | null => {
      const fila = contenido.replace(/^\uFEFF/, '').split(/\r?\n/)[1] ?? '';
      return fila.split('|')[7]?.trim() || null;
    };

    if (conFormatoDistinto.length > 0) {
      const version = versionDeclarada(comercioCsv);
      const detalle = conFormatoDistinto
        .map(([nombre, contenido, esperado]) =>
          `${nombre} (trae ${columnasDe(contenido)} columnas y se esperaban ${columnasDe(esperado)})`,
        )
        .join(', ');

      // Un archivo que solo trae el encabezado merece decirlo aparte: el
      // usuario puede pensar que el problema es el formato cuando en realidad
      // no hay nada para importar.
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

    const reporte = await importarDump(prisma, {
      comercios: comercio.items,
      sucursales: sucursales.items,
      productos: productos.items,
      descartadas: comercio.descartadas + sucursales.descartadas + productos.descartadas,
    });

    res.status(200).json({ ok: true, ...reporte });
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
