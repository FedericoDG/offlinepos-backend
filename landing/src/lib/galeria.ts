/**
 * Inventario de las capturas de la galería.
 *
 * La lista se arma leyendo `public/galeria/` en tiempo de build: si agregás o
 * quitás una imagen, la galería se actualiza sola, sin tocar código ni datos.
 *
 * Los rótulos salen del nombre del archivo —que ya describe la pantalla— y hay
 * un mapa para los que se leen mejor con otra forma. Las capturas vienen del
 * script `scripts/capturar-pantallas.mjs` del proyecto del POS.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ImagenGaleria {
  /** Nombre del archivo, por ejemplo `app-01-dashboard.png`. */
  archivo: string;
  /** Ruta pública para el `src`, por ejemplo `/galeria/app-01-dashboard.png`. */
  src: string;
  /** Rótulo visible bajo la miniatura. */
  etiqueta: string;
  /** Grupo al que pertenece la pantalla (menú visible en la miniatura). */
  grupo: string;
  /** Texto alternativo de la imagen. */
  alt: string;
}

const RUTA_PUBLICA = "/galeria/";

/**
 * Carpeta física de las capturas.
 *
 * Ojo: no sirve resolverse sólo con `import.meta.url`. Al empaquetar, Astro mueve
 * este módulo a un directorio interno y la ruta relativa deja de apuntar al
 * proyecto, con lo que la galería quedaba vacía sin decir nada. Se prueban varias
 * candidatas y, si ninguna existe, se avisa por consola en vez de fallar mudo.
 */
function carpetaGaleria(): string {
  const candidatas = [
    path.join(process.cwd(), "public", "galeria"),
    fileURLToPath(new URL("../../public/galeria/", import.meta.url)),
  ];
  const encontrada = candidatas.find((c) => fs.existsSync(c));
  if (!encontrada) {
    console.warn(`[galeria] no se encontró la carpeta de capturas. Probé: ${candidatas.join(", ")}`);
  }
  return encontrada ?? candidatas[0];
}

const CARPETA = carpetaGaleria();
const EXTENSIONES = /\.(png|jpe?g|webp|avif)$/i;

/**
 * Rótulo natural por pantalla.
 *
 * La clave es `grupo/nombre`, **sin el número de orden**: así renumerar un
 * archivo (o insertar uno en el medio) no rompe su rótulo. Antes las claves
 * incluían el número y renumerar hacía que el rótulo se perdiera.
 *
 * Están todas las pantallas que existen, no sólo las que hoy están en la
 * carpeta: si volvés a poner una captura, ya tiene su nombre listo.
 */
const ETIQUETAS: Record<string, string> = {
  "app/dashboard": "Dashboard",
  "app/punto-de-venta": "Punto de venta",
  "app/ia-integrada": "IA integrada",
  "app/caja": "Caja y arqueo",
  "app/inventario": "Inventario",
  "app/productos": "Productos",
  "app/productos-combos": "Productos · Combos",
  "app/compras": "Compras",
  "app/gastos": "Gastos",
  "app/presupuestos": "Presupuestos",
  "app/clientes": "Clientes",
  "app/unidades": "Unidades",
  "app/marcas": "Marcas",
  "app/categorias": "Categorías",
  "app/proveedores": "Proveedores",
  "app/informe-financiero": "Informe financiero",
  "app/inteligencia": "Inteligencia de negocio",
  "app/usuarios": "Usuarios",
  "app/ayuda": "Ayuda integrada",
  "app/precios-mayoristas": "Precios mayoristas",
  "config/apariencia": "Apariencia",
  "config/asistente-binny": "Asistente con IA",
  "config/metodos-de-pago": "Métodos de pago",
  "config/comercio-e-impresion": "Comercio e impresión",
  "config/modulos-y-catalogo": "Módulos y catálogo",
  "config/impuestos-y-facturacion": "Impuestos y facturación",
  "config/balanza-y-peso": "Balanza y peso",
  "config/promociones-y-descuentos": "Promociones y descuentos",
  "config/recargos-y-delivery": "Recargos y delivery",
  "config/copias-de-seguridad": "Copias de seguridad",
  "config/mantenimiento": "Mantenimiento",
  "extra/recordatorios": "Recordatorios",
  "extra/paleta-comandos": "Paleta de comandos",
  "previo/instalacion": "Instalación",
  "previo/activacion": "Activación de licencia",
  "previo/crear-admin": "Alta del administrador",
  "previo/login": "Inicio de sesión",
  "previo/wizard": "Bienvenida",
  "previo/bloqueo": "Licencia bloqueada",
};
/** Grupo visible por prefijo del archivo. */
const GRUPOS: Record<string, string> = {
  app: "El sistema",
  config: "Configuración",
  extra: "Extras",
  previo: "Primeros pasos",
};

/** Clave de rótulo: `app-03-punto-de-venta.png` -> `app/punto-de-venta`. */
function claveEstable(base: string): string {
  return base.replace(/^([a-z]+)-\d+-/, "$1/");
}

/** Último recurso: arma un rótulo legible a partir del nombre del archivo. */
function derivarEtiqueta(base: string): string {
  const sinPrefijo = base.replace(/^[a-z]+-\d+-/, "");
  const texto = sinPrefijo.replace(/-/g, " ").trim();
  if (!texto) return base;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Todas las capturas de la galería, ordenadas por nombre de archivo.
 *
 * El orden es el de los propios archivos (`app-*`, `config-*`, `extra-*`,
 * `previo-*`) porque vienen numerados desde el script de capturas.
 */
export function listarGaleria(): ImagenGaleria[] {
  if (!fs.existsSync(CARPETA)) return [];

  return fs
    .readdirSync(CARPETA)
    .filter((archivo) => EXTENSIONES.test(archivo))
    .sort((a, b) => a.localeCompare(b, "es"))
    .map((archivo) => {
      const base = archivo.replace(/\.[^.]+$/, "");
      const prefijo = base.split("-")[0];
      const etiqueta = ETIQUETAS[claveEstable(base)] ?? derivarEtiqueta(base);

      return {
        archivo,
        src: `${RUTA_PUBLICA}${archivo}`,
        etiqueta,
        grupo: GRUPOS[prefijo] ?? "Capturas",
        alt: `Captura de la pantalla ${etiqueta}`,
      };
    });
}
