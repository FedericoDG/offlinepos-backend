import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from '../../config/env';
import { httpError } from '../../utils/api-error';

/**
 * Publicación de versiones del POS de escritorio.
 *
 * El panel sube los instaladores ya firmados (NSIS + MSI con sus .sig) y este
 * módulo los guarda en `updates/archivos/v{version}/` y regenera
 * `updates/latest.json`, que el updater de Tauri consulta en
 * GET /api/updates/latest.json (ruta pública, servida como estático).
 *
 * La confianza no viene del transporte sino de la firma minisign embebida en
 * el binario: aquí solo se almacenan archivos y se arman URLs absolutas.
 */

export interface ArchivoVersion {
  nombre: string;
  url: string;
  bytes: number;
}

export interface VersionVigente {
  version: string | null;
  notas: string | null;
  pub_date: string | null;
  archivos: ArchivoVersion[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carpeta estática en la raíz del repo (hermana de backend/ y panel/).
const RAIZ_UPDATES = path.resolve(__dirname, '../../../../updates');
const DIR_ARCHIVOS = path.join(RAIZ_UPDATES, 'archivos');
const PATH_LATEST = path.join(RAIZ_UPDATES, 'latest.json');

const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * Los instaladores de Tauri llevan la versión en el nombre
 * (ej. `sistema_desktop_0.1.3_x64-setup.exe`). Si el nombre trae una
 * versión distinta a la declarada, publicar igual dejaría a las cajas en
 * un loop: ven "nueva versión", instalan... y siguen en la vieja porque el
 * binario no cambió. Se rechaza con un mensaje que dice qué hacer.
 */
function coherenciaVersionInstalador(nombreArchivo: string, versionDeclarada: string): void {
  // Tauri nombra `sistema_desktop_0.1.3_x64-setup.exe`: versión entre
  // separadores. Componentes de hasta 3 dígitos para no confundir fechas
  // (ej. un "backup-2024.01.01.exe" no debe disparar el guard).
  const m = nombreArchivo.match(/[-_](\d{1,3}\.\d{1,3}\.\d{1,3})(?:[-_.]|$)/);
  if (!m) return; // Nombre atípico: no hay contra qué comparar, se permite.
  if (m[1] !== versionDeclarada) {
    throw httpError(
      `El instalador "${nombreArchivo}" parece ser de la versión ${m[1]} pero declaraste la ${versionDeclarada}. Subí el build correspondiente o corregí la versión: publicar así dejaría a las cajas ofreciéndose una actualización que nunca converge.`,
      400
    );
  }
}

function asegurarDirs(): void {
  fs.mkdirSync(DIR_ARCHIVOS, { recursive: true });
}

function basePublica(): string {
  return env.PUBLIC_BASE_URL.replace(/\/$/, '');
}

export function dirUpdates(): string {
  return RAIZ_UPDATES;
}

export function leerLatest(): any | null {
  try {
    const texto = fs.readFileSync(PATH_LATEST, 'utf8');
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

/** Estado vigente para el panel: latest.json + archivos con tamaño. */
export function estadoActual(): VersionVigente {
  const latest = leerLatest();
  if (!latest) {
    return { version: null, notas: null, pub_date: null, archivos: [] };
  }

  const dirVersion = path.join(DIR_ARCHIVOS, `v${latest.version}`);
  return {
    version: latest.version ?? null,
    notas: latest.notas ?? null,
    pub_date: latest.pub_date ?? null,
    archivos: archivosDe(dirVersion, latest.version),
  };
}

function archivosDe(dirVersion: string, version: string): ArchivoVersion[] {
  try {
    return fs
      .readdirSync(dirVersion)
      .filter((n) => !n.endsWith('.sig'))
      .map((n) => ({
        nombre: n,
        url: `${basePublica()}/api/updates/archivos/v${version}/${n}`,
        bytes: fs.statSync(path.join(dirVersion, n)).size,
      }));
  } catch {
    return [];
  }
}

export interface VersionPublicada {
  version: string;
  esVigente: boolean;
  archivos: ArchivoVersion[];
  bytes: number;
}

/** Todas las versiones publicadas en disco (para el historial del panel). */
export function listarVersiones(): VersionPublicada[] {
  let vigente: string | null = null;
  try {
    vigente = leerLatest()?.version ?? null;
  } catch {
    vigente = null;
  }

  let carpetas: string[] = [];
  try {
    carpetas = fs
      .readdirSync(DIR_ARCHIVOS, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^v\d+\.\d+\.\d+$/.test(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }

  return carpetas
    .map((c) => {
      const version = c.slice(1);
      const archivos = archivosDe(path.join(DIR_ARCHIVOS, c), version);
      return {
        version,
        esVigente: version === vigente,
        archivos,
        bytes: archivos.reduce((s, a) => s + a.bytes, 0),
      };
    })
    .sort((a, b) => {
      if (a.esVigente !== b.esVigente) return a.esVigente ? -1 : 1;
      return b.version.localeCompare(a.version, undefined, { numeric: true });
    });
}

/**
 * Elimina una versión completa del disco. Si era la vigente, también se
 * borra latest.json y el sistema vuelve a "sin versión publicada" (las
 * cajas dejan de ver actualizaciones hasta que se publique una nueva).
 */
export function eliminarVersion(versionCruda: string): { eliminado: boolean; version: string } {
  const version = versionCruda.trim();
  if (!SEMVER.test(version)) {
    throw httpError('Versión inválida', 400);
  }

  const dirVersion = path.join(DIR_ARCHIVOS, `v${version}`);
  let existe = false;
  try {
    existe = fs.statSync(dirVersion).isDirectory();
  } catch {
    existe = false;
  }
  if (!existe) {
    throw httpError(`La versión ${version} no existe`, 404);
  }

  fs.rmSync(dirVersion, { recursive: true, force: true });

  const vigente = leerLatest()?.version ?? null;
  if (vigente === version) {
    try {
      fs.unlinkSync(PATH_LATEST);
    } catch {
      /* ya no estaba */
    }
  }

  return { eliminado: true, version };
}

export interface ArchivoSubido {
  /** Ruta temporal donde lo dejó multer. */
  tmp: string;
  /** Nombre final saneado dentro de la carpeta de la versión. */
  nombre: string;
}

export interface SubidaVersion {
  version: string;
  notas?: string;
  setup?: ArchivoSubido;
  setupSig?: ArchivoSubido;
  msi?: ArchivoSubido;
  msiSig?: ArchivoSubido;
}

/**
 * Registra una versión: mueve los archivos subidos a su carpeta y regenera
 * latest.json. El instalador que el updater de Tauri descarga en Windows es
 * el NSIS (.exe); el MSI queda disponible para instalación manual.
 */
export function publicarVersion(subida: SubidaVersion): VersionVigente {
  const version = subida.version.trim();
  if (!SEMVER.test(version)) {
    throw httpError('La versión debe tener formato semver (ej. 0.1.4)', 400);
  }
  if (!subida.setup?.tmp || !subida.setupSig?.tmp) {
    throw httpError('Faltan el instalador NSIS (.exe) y su firma (.sig)', 400);
  }
  if ((subida.msi && !subida.msiSig) || (!subida.msi && subida.msiSig)) {
    throw httpError('El MSI y su firma (.sig) van juntos o no van', 400);
  }

  asegurarDirs();
  const destino = path.join(DIR_ARCHIVOS, `v${version}`);
  fs.mkdirSync(destino, { recursive: true });

  coherenciaVersionInstalador(subida.setup?.nombre ?? '', version);

  const mover = (a: ArchivoSubido | undefined): void => {
    if (!a?.tmp) return;
    fs.renameSync(a.tmp, path.join(destino, a.nombre));
  };

  mover(subida.setup);
  mover(subida.setupSig);
  if (subida.msi && subida.msiSig) {
    mover(subida.msi);
    mover(subida.msiSig);
  }

  const firma = fs.readFileSync(path.join(destino, `${subida.setup.nombre}.sig`), 'utf8').trim();
  if (!firma) {
    throw httpError('La firma del instalador está vacía', 400);
  }

  const latest = {
    version,
    notas: (subida.notas ?? '').trim(),
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': {
        signature: firma,
        url: `${basePublica()}/api/updates/archivos/v${version}/${subida.setup.nombre}`,
      },
    },
  };

  fs.writeFileSync(PATH_LATEST, JSON.stringify(latest, null, 2) + '\n');

  return estadoActual();
}
