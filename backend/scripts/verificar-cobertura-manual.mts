/**
 * Verificación de cobertura del manual de Binny (T6 — garantía "TODO ES TODO").
 *
 * Enumera las pantallas, pestañas y accesos relevantes DESDE EL CÓDIGO del
 * frontend de escritorio (sistema_desktop/src) y comprueba que cada uno tenga
 * una entrada en `src/features/chat/chat.manual.ts`. Si algo no está cubierto,
 * sale con código 1 y lista los faltantes con su archivo de origen.
 *
 * Fuentes del inventario (path configurable por `POS_DESKTOP_SRC`):
 *   - Ítems del sidebar: `components/Sidebar.tsx` (atributo label="…").
 *   - Pestañas de Configuración: `screens/ConfiguracionScreen.tsx` (array TABS).
 *   - Pestañas de Productos: `screens/ProductosScreen.tsx` (unión de tabActiva).
 *   - Pantallas: todos los `screens/*.tsx` (incluye arranque: Activación,
 *     Crear Admin, Asistente de Instalación y Login).
 *   - Paleta de comandos (`components/CommandPalette.tsx`) y recordatorios
 *     (`components/recordatorios/` + campana del TopBar).
 *   - Wizard de bienvenida (`components/WizardBienvenida.tsx`).
 *
 * CRITERIO DE COBERTURA (tolerante, a propósito):
 *   Un ítem está cubierto si alguna de sus claves normalizadas (sin acentos)
 *   coincide —como palabra o frase completa— con el `nombre`, el `id` o alguna
 *   `palabras_clave` de CUALQUIER entrada del manual. Así se admite que una
 *   entrada AGRUPE varias pantallas: por ejemplo, las 11 pestañas de
 *   Configuración pueden mapear a entradas propias o quedar cubiertas por la
 *   entrada "Configuración (11 pestañas)" (cuyas palabras clave incluyen
 *   apariencia, métodos de pago, módulos, impuestos, balanza, respaldos,
 *   mantenimiento, impresora).
 *
 *   Las pantallas que NO son destinos navegables (componentes embebidos) se
 *   excluyen con un motivo explícito en PANTALLAS_EXCLUIDAS.
 *
 * Uso:
 *   npx tsx scripts/verificar-cobertura-manual.mts
 *   POS_DESKTOP_SRC=/ruta/a/sistema_desktop/src npx tsx scripts/verificar-cobertura-manual.mts
 *
 * Autotest: `POS_MANUAL_EXCLUIR=combos` simula la falta de esa entrada (sirve
 * para comprobar que el script efectivamente falla y lista el faltante).
 */
import fs from 'node:fs';
import path from 'node:path';

import { MANUAL_ENTRADAS, type EntradaManual } from '../src/features/chat/chat.manual';

const DESKTOP_SRC =
  process.env.POS_DESKTOP_SRC ?? '/home/federico/Escritorio/POS/sistema_desktop/src';

/** Ids de entradas a ignorar (solo para el autotest; vacío en uso normal). */
const EXCLUIR = (process.env.POS_MANUAL_EXCLUIR ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ---------------------------------------------------------------------------
// Normalización y match (mismo criterio que chat.manual.ts)
// ---------------------------------------------------------------------------

function normalizar(texto: string): string {
  return (texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const REGEX_ESPECIALES = /[.*+?^${}()|[\]\\]/g;

/** ¿La clave aparece en el texto como palabra completa o frase? */
function contieneClave(textoNorm: string, clave: string): boolean {
  const c = normalizar(clave).trim();
  if (!c) return false;
  if (c.includes(' ')) return textoNorm.includes(c);
  return new RegExp(`(^|[^a-z0-9])${c.replace(REGEX_ESPECIALES, '\\$&')}([^a-z0-9]|$)`).test(textoNorm);
}

interface EntradaIndexada {
  entrada: EntradaManual;
  textos: string[];
}

function indexarManual(entradas: EntradaManual[]): EntradaIndexada[] {
  return entradas.map((e) => ({
    entrada: e,
    textos: [e.nombre, e.id, ...e.palabras_clave].map(normalizar),
  }));
}

/** Primera entrada del manual que cubre la clave, o null. */
function entradaQueCubre(clave: string, indice: EntradaIndexada[]): EntradaManual | null {
  for (const it of indice) {
    for (const t of it.textos) {
      if (contieneClave(t, clave)) return it.entrada;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Inventario desde el código del frontend
// ---------------------------------------------------------------------------

interface ItemInventario {
  grupo: string;
  etiqueta: string;
  origen: string;
  claves: string[];
}

/**
 * Claves curadas por etiqueta visible (sidebar, pestañas, accesos). Las claves
 * son los términos con los que el manual debería reconocer la pantalla.
 */
const CLAVES: Record<string, string[]> = {
  // Sidebar
  dashboard: ['dashboard', 'inicio'],
  'punto de venta': ['punto de venta', 'pos'],
  caja: ['caja'],
  inventario: ['inventario', 'stock'],
  productos: ['productos', 'producto'],
  compras: ['compras', 'compra'],
  gastos: ['gastos', 'gasto'],
  presupuestos: ['presupuestos', 'presupuesto'],
  clientes: ['clientes', 'cliente'],
  unidades: ['unidades', 'unidad'],
  marcas: ['marcas', 'marca'],
  categorias: ['categorias', 'categoria'],
  proveedores: ['proveedores', 'proveedor'],
  'informe financiero': ['informe financiero', 'informe'],
  inteligencia: ['inteligencia'],
  usuarios: ['usuarios', 'usuario'],
  configuracion: ['configuracion'],
  // Pestañas de Configuración
  apariencia: ['apariencia'],
  'asistente binny (ia)': ['binny', 'asistente'],
  'metodos de pago': ['metodos de pago'],
  'comercio e impresion': ['impresora', 'impresion'],
  'modulos y catalogo': ['modulos', 'catalogo'],
  'impuestos y facturacion': ['impuestos', 'iva'],
  'balanza y peso (ean-13)': ['balanza'],
  'promociones y descuentos': ['promociones', 'descuento'],
  'recargos y delivery': ['recargos', 'delivery'],
  'copias de seguridad': ['respaldos', 'copia de seguridad'],
  mantenimiento: ['mantenimiento'],
  // Pestañas de Productos
  combos: ['combos', 'combo'],
  // Accesos y pantallas de arranque
  activacion: ['activacion', 'licencia'],
  'crear administrador': ['crear admin', 'administrador'],
  'asistente de instalacion': ['instalacion', 'asistente'],
  'inicio de sesion': ['login', 'iniciar sesion'],
  'paleta de comandos': ['paleta', 'ctrl+k', 'atajos'],
  recordatorios: ['recordatorios', 'recordatorio', 'campana'],
  'wizard de bienvenida': ['wizard', 'bienvenida', 'tutorial'],
};

/** Claves por nombre de archivo de pantalla (screens/*.tsx). */
const CLAVES_PANTALLA: Record<string, string[]> = {
  ActivacionScreen: ['activacion', 'licencia'],
  AnaliticaScreen: ['inteligencia'],
  AsistenteInstalacionScreen: ['instalacion', 'asistente'],
  BloqueoScreen: ['licencia'],
  CajaScreen: ['caja'],
  CategoriasScreen: ['categorias'],
  ChatScreen: ['binny', 'chat'],
  ClientesScreen: ['clientes'],
  ComprasScreen: ['compras'],
  ConfiguracionScreen: ['configuracion'],
  CrearAdminScreen: ['crear admin', 'administrador'],
  GastosScreen: ['gastos'],
  HomeScreen: ['dashboard', 'inicio'],
  InformeFinancieroScreen: ['informe financiero'],
  InventarioScreen: ['inventario'],
  LoginScreen: ['login'],
  MarcasScreen: ['marcas'],
  PresupuestosScreen: ['presupuestos'],
  ProductoDetalleScreen: ['producto'],
  ProductosScreen: ['productos'],
  ProveedoresScreen: ['proveedores'],
  PuntoVentaScreen: ['punto de venta', 'pos'],
  UnidadesScreen: ['unidades'],
  UsuariosScreen: ['usuarios'],
};

/** Pantallas excluidas del inventario, con su motivo (documentado). */
const PANTALLAS_EXCLUIDAS: Record<string, string> = {
  GraficoChat:
    'Componente de gráfico embebido en el chat (bloque visual "chart"), no es una pantalla navegable.',
};

/** Etiquetas legibles para las pantallas (fallback: se deriva del archivo). */
const ETIQUETA_PANTALLA: Record<string, string> = {
  ActivacionScreen: 'Activación',
  AnaliticaScreen: 'Inteligencia',
  AsistenteInstalacionScreen: 'Asistente de instalación',
  BloqueoScreen: 'Bloqueo de licencia',
  CajaScreen: 'Caja',
  CategoriasScreen: 'Categorías',
  ChatScreen: 'Asistente Binny (chat)',
  ClientesScreen: 'Clientes',
  ComprasScreen: 'Compras',
  ConfiguracionScreen: 'Configuración',
  CrearAdminScreen: 'Crear administrador',
  GastosScreen: 'Gastos',
  HomeScreen: 'Home',
  InformeFinancieroScreen: 'Informe Financiero',
  InventarioScreen: 'Inventario',
  LoginScreen: 'Inicio de sesión',
  MarcasScreen: 'Marcas',
  PresupuestosScreen: 'Presupuestos',
  ProductoDetalleScreen: 'Detalle de producto',
  ProductosScreen: 'Productos',
  ProveedoresScreen: 'Proveedores',
  PuntoVentaScreen: 'Punto de Venta',
  UnidadesScreen: 'Unidades',
  UsuariosScreen: 'Usuarios',
};

const STOPWORDS = new Set(['e', 'y', 'o', 'de', 'del', 'la', 'el', 'los', 'las', 'en', 'a', 'screen']);

/** Deriva claves de un nombre libre (fallback para ítems nuevos). */
function clavesDeNombre(nombre: string): string[] {
  return normalizar(nombre)
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOPWORDS.has(w));
}

function etiquetaDePantalla(base: string): string {
  return (
    ETIQUETA_PANTALLA[base] ??
    base
      .replace(/Screen$/, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .trim()
  );
}

function leer(ruta: string): string {
  try {
    return fs.readFileSync(ruta, 'utf8');
  } catch {
    return '';
  }
}

function existe(ruta: string): boolean {
  try {
    fs.accessSync(ruta);
    return true;
  } catch {
    return false;
  }
}

function descubrirInventario(srcDir: string): ItemInventario[] {
  const items: ItemInventario[] = [];

  const agregar = (grupo: string, etiqueta: string, origen: string, claves?: string[]) => {
    if (!etiqueta.trim()) return;
    items.push({
      grupo,
      etiqueta: etiqueta.trim(),
      origen,
      claves: claves ?? CLAVES[normalizar(etiqueta)] ?? clavesDeNombre(etiqueta),
    });
  };

  // 1) Ítems del sidebar.
  const sidebar = leer(path.join(srcDir, 'components/Sidebar.tsx'));
  // Se exige un espacio antes de `label=` para no capturar `aria-label=`.
  for (const m of sidebar.matchAll(/(?:^|\s)label="([^"]+)"/g)) {
    agregar('Sidebar', m[1], 'components/Sidebar.tsx');
  }

  // 2) Pestañas de Configuración (array TABS).
  const config = leer(path.join(srcDir, 'screens/ConfiguracionScreen.tsx'));
  for (const m of config.matchAll(/label:\s*"([^"]+)"/g)) {
    agregar('Configuración', m[1], 'screens/ConfiguracionScreen.tsx');
  }

  // 3) Pestañas de Productos (unión del estado tabActiva).
  const productos = leer(path.join(srcDir, 'screens/ProductosScreen.tsx'));
  const union = productos.match(/useState<([^>]*)>\(\s*"productos"\s*\)/);
  const etiquetasTab: Record<string, string> = { productos: 'Productos', combos: 'Combos' };
  if (union) {
    for (const m of union[1].matchAll(/"([^"]+)"/g)) {
      const id = m[1];
      agregar('Productos', etiquetasTab[id] ?? id, 'screens/ProductosScreen.tsx', CLAVES[id]);
    }
  }

  // 4) Pantallas (screens/*.tsx), incluidas las de arranque.
  const screensDir = path.join(srcDir, 'screens');
  if (existe(screensDir)) {
    for (const archivo of fs.readdirSync(screensDir)) {
      if (!archivo.endsWith('.tsx')) continue;
      const base = archivo.replace(/\.tsx$/, '');
      if (base in PANTALLAS_EXCLUIDAS) continue;
      agregar(
        'Pantallas',
        etiquetaDePantalla(base),
        `screens/${archivo}`,
        CLAVES_PANTALLA[base] ?? clavesDeNombre(base),
      );
    }
  }

  // 5) Paleta de comandos.
  if (existe(path.join(srcDir, 'components/CommandPalette.tsx'))) {
    agregar('Accesos', 'Paleta de comandos', 'components/CommandPalette.tsx');
  }

  // 6) Recordatorios (campana del TopBar + drawer de recordatorios).
  const topBar = leer(path.join(srcDir, 'components/TopBar.tsx'));
  const tieneRecordatorios =
    /recordatorio/i.test(topBar) || existe(path.join(srcDir, 'components/recordatorios'));
  if (tieneRecordatorios) {
    agregar('Accesos', 'Recordatorios', 'components/TopBar.tsx + components/recordatorios/');
  }

  // 7) Wizard de bienvenida.
  if (existe(path.join(srcDir, 'components/WizardBienvenida.tsx'))) {
    agregar('Accesos', 'Wizard de bienvenida', 'components/WizardBienvenida.tsx');
  }

  // Dedupe por etiqueta normalizada (un mismo nombre puede aparecer en sidebar,
  // pantalla y paleta): se conserva el primero y se listan los orígenes juntos.
  const porEtiqueta = new Map<string, ItemInventario>();
  for (const it of items) {
    const k = normalizar(it.etiqueta);
    const previo = porEtiqueta.get(k);
    if (previo) {
      if (!previo.origen.includes(it.origen)) previo.origen += `, ${it.origen}`;
      continue;
    }
    porEtiqueta.set(k, it);
  }
  return [...porEtiqueta.values()];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  console.log('=== Cobertura del manual de Binny (TODO ES TODO) ===');
  console.log(`Fuente del frontend: ${DESKTOP_SRC}`);

  if (!existe(DESKTOP_SRC)) {
    console.error(`\n❌ No existe la carpeta del frontend: ${DESKTOP_SRC}`);
    console.error('   Definí POS_DESKTOP_SRC con la ruta a sistema_desktop/src.');
    process.exit(2);
  }

  const inventario = descubrirInventario(DESKTOP_SRC);
  const entradas = MANUAL_ENTRADAS.filter((e) => !EXCLUIR.includes(e.id));
  if (EXCLUIR.length > 0) {
    console.log(`(autotest) entradas excluidas: ${EXCLUIR.join(', ')}`);
  }
  const indice = indexarManual(entradas);

  const cubiertas: ItemInventario[] = [];
  const faltantes: Array<ItemInventario & { cubiertaPor?: undefined }> = [];
  for (const it of inventario) {
    const entrada = it.claves
      .map((clave) => entradaQueCubre(clave, indice))
      .find((e): e is EntradaManual => e !== null);
    if (entrada) cubiertas.push(it);
    else faltantes.push(it);
  }

  const total = inventario.length;
  console.log(`\nResumen: cubiertas ${cubiertas.length}/${total}`);

  if (faltantes.length > 0) {
    console.log('\n❌ Pantallas SIN entrada en el manual:');
    for (const f of faltantes) {
      console.log(`  - [${f.grupo}] ${f.etiqueta}  (claves: ${f.claves.join(', ') || '—'})`);
      console.log(`      origen: ${f.origen}`);
    }
    console.log('\nAgregá una entrada en src/features/chat/chat.manual.ts que cubra cada una.');
    process.exit(1);
  }

  console.log('✓ Todas las pantallas y accesos relevantes tienen entrada en el manual.');
  process.exit(0);
}

main();
