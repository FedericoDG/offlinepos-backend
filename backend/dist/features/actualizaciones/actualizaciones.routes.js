import { Router } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { authenticateJWT, requireAdmin } from '../../middlewares/auth.middleware';
import { handleApiError } from '../../utils/api-error';
import { dirUpdates, estadoActual, eliminarVersion, listarVersiones, publicarVersion } from './actualizaciones.service';
/**
 * Router del panel para publicar versiones del POS de escritorio.
 * Se monta sobre `/api/updates/admin` (upload/listado, solo admins).
 * La descarga (`GET /api/updates/*`) es pública y la sirve express.static.
 */
const router = Router();
const dirTmp = path.join(dirUpdates(), 'tmp');
/** Conserva el nombre original (saneado): el updater ejecuta el .exe descargado. */
function nombreSeguro(original) {
    const base = path.basename(original).replace(/[^a-zA-Z0-9._-]/g, '_');
    return base.slice(0, 120) || 'archivo';
}
// Límite generoso: el MSI puede superar los 30 MB.
const subida = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
            // Perezoso e idempotente: si alguien borra updates/ con el server
            // corriendo, la carpeta se recrea acá en vez de romper la subida.
            fs.mkdirSync(dirTmp, { recursive: true });
            cb(null, dirTmp);
        },
        filename: (_req, file, cb) => cb(null, `${Date.now()}-${nombreSeguro(file.originalname)}`),
    }),
    limits: { fileSize: 120 * 1024 * 1024, files: 4 },
});
router.use(authenticateJWT, requireAdmin);
/** Versión vigente publicada (lo que ven los POS) + historial de versiones. */
router.get('/actual', async (_req, res) => {
    try {
        res.status(200).json({ ...estadoActual(), versiones: listarVersiones() });
    }
    catch (error) {
        handleApiError(error, res, 'Error al consultar la versión vigente');
    }
});
/**
 * Publica una versión: recibe los instaladores ya firmados y regenera
 * latest.json. Campos multipart: version, notas (opcional), setup (.exe),
 * setupFirma (.sig), msi (.msi, opcional), msiFirma (.sig, opcional).
 */
router.post('/subir', subida.fields([
    { name: 'setup', maxCount: 1 },
    { name: 'setupFirma', maxCount: 1 },
    { name: 'msi', maxCount: 1 },
    { name: 'msiFirma', maxCount: 1 },
]), async (req, res) => {
    const temporales = [];
    try {
        const archivos = (req.files ?? {});
        const tomar = (campo) => {
            const f = archivos[campo]?.[0];
            if (!f)
                return undefined;
            temporales.push(f.path);
            return { tmp: f.path, nombre: nombreSeguro(f.originalname) };
        };
        const setup = tomar('setup');
        const setupFirma = tomar('setupFirma');
        const msi = tomar('msi');
        const msiFirma = tomar('msiFirma');
        const resultado = publicarVersion({
            version: String(req.body?.version ?? ''),
            notas: String(req.body?.notas ?? ''),
            setup,
            // Las firmas se guardan como "<instalador>.sig" para que el panel
            // y el updater las encuentren junto a su archivo.
            setupSig: setupFirma && setup ? { tmp: setupFirma.tmp, nombre: `${setup.nombre}.sig` } : undefined,
            msi,
            msiSig: msiFirma && msi ? { tmp: msiFirma.tmp, nombre: `${msi.nombre}.sig` } : undefined,
        });
        res.status(201).json({
            message: `Versión ${resultado.version} publicada correctamente`,
            ...resultado,
        });
    }
    catch (error) {
        for (const t of temporales) {
            try {
                fs.unlinkSync(t);
            }
            catch {
                /* ya se movió o no existe */
            }
        }
        handleApiError(error, res, 'Error al publicar la versión');
    }
});
/**
 * Elimina una versión completa del disco. Si era la vigente, también se
 * borra latest.json y el sistema queda sin versión publicada.
 */
router.delete('/versiones/:version', async (req, res) => {
    try {
        const r = eliminarVersion(req.params.version);
        res.status(200).json({
            message: `Versión ${r.version} eliminada por completo`,
            ...estadoActual(),
            versiones: listarVersiones(),
        });
    }
    catch (error) {
        handleApiError(error, res, 'Error al eliminar la versión');
    }
});
/**
 * Multer corre como middleware antes del handler: sus errores (carpeta
 * faltante, archivo muy grande, etc.) escaparían al manejador HTML de
 * Express. Acá se traducen a JSON para que el panel los muestre legibles.
 */
router.use((err, _req, res, _next) => {
    handleApiError(err, res, 'Error al procesar la subida');
});
export default router;
