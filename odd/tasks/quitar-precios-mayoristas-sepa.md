# Quitar Precios Mayoristas (SEPA) de POS Offline

Objetivo: eliminar por completo la feature de Precios Mayoristas SEPA del POS
Offline: desktop (UI + Rust), backend, panel de administración, manual de
Binny y ayuda generada. No se toca nada de POS Online.

Repos: `sistema_desktop` (desktop) y `backend_panel_administracion` (backend +
panel + manual fuente). Runner backend: `npx tsx pruebas/correr.ts`.

## Specs

- **S1 — El buscador desaparece de la UI.** Se borran
  `PreciosMayoristasScreen.tsx` y su entrada en el menú lateral, el command
  palette, el inicio, el registro de vistas y el asistente de instalación.
- **S2 — El módulo deja de ofrecerse.** El flag `usar_precios_mayoristas` /
  `usarPreciosMayoristas` sale del estado de la app, del catálogo de módulos,
  de la configuración y del guardado. No queda una casilla que active algo
  inexistente.
- **S3 — El desktop deja de hablar con el servidor por esto.** Se elimina el
  módulo Rust `precios_mayoristas`, sus dos comandos Tauri y las dos URLs de
  `config.rs`.
- **S4 — El backend pierde la feature.** Se borra `features/precios-mayoristas/`
  completo (importación del dump, parser, búsqueda, sucursales y rutas) y sus
  dos montajes en `index.ts`, incluido el endpoint público de búsqueda.
- **S5 — El panel pierde la administración.** Se borran las páginas de
  precios mayoristas, sus server actions, su item de navegación y sus tipos y
  consultas.
- **S6 — Se van las tablas.** Salen del schema los modelos `Cadena`,
  `PrecioMayorista`, `SucursalCadena` y `PrecioSucursal`, y una migración
  nueva hace `DROP TABLE` de las cuatro. Es irreversible: son datos de dumps
  importados (~600k filas), no datos del comercio, y se regeneran desde el ZIP
  si algún día vuelve la feature.
- **S7 — El manual deja de mencionarlo.** Se borra la entrada
  `precios-mayoristas` de `chat.manual.ts` y se regenera
  `sistema_desktop/src/data/manual.faq.json` con
  `npm run generar:manual-faq`. `verificar:manual-faq` tiene que quedar en
  verde.
- **S8 — Nada más lo referencia.** Se limpian fixtures/mocks del desktop y
  cualquier tipo o título que lo nombre.
- **S9 — Nada que no sea esta feature cambia.** Se conservan: la opción de IVA
  "Factura A mayorista" del escaneo de facturas, la palabra clave
  `mayorista` del manual de Proveedores (es un proveedor, no esta feature), y
  los nombres de proveedores de demo de las simulaciones.

## Tasks

- **T1 — Backend + panel** (feature, montajes, schema, migración, manual).
- **T2 — Desktop Rust** (módulo, comandos, config, flag de licencia).
- **T3 — Desktop UI** (pantalla, sidebar, palette, inicio, configuración,
  asistente, vistas, fixtures).
- **T4 — Manual generado** (regenerar el FAQ y verificar).

## Log

- **L1** (2026-10-21, pedido textual): «Vamos ahora al POS Offline. Ese POS
  tiene toda una feature de Precios Mayoristas SEPA. QUITA TODO ESO, hasta la
  parte de ayuda donde se hace referencia a el».
- **L2** El feature no tiene tablas en SQLite: el desktop consulta al backend,
  que guarda `Cadena`, `PrecioMayorista`, `SucursalCadena` y `PrecioSucursal`
  en Postgres. Borrar las tablas también libera storage del plan Free de Neon.
- **L3** `sistema_desktop/src/data/manual.faq.json` es **generado** desde
  `backend/src/features/chat/chat.manual.ts` por
  `scripts/generar-manual-faq.mts`; se edita la fuente y se regenera.
