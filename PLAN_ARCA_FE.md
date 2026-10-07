# PLAN — Facturación Electrónica ARCA (ex AFIP) con delegación cero

> **Estado:** PLAN (no implementado) · **Fecha:** 2026-09-19
> **Rama:** `mejoras-chat-optimizacion` · **Repos:** `backend_panel_administracion` (Node/TS) · `sistema_desktop` (Tauri/Rust + SQLite local)
> **SDK:** [`@arcasdk/core`](https://github.com/ralcorta/arcasdk) — MIT, Rodrigo Alcorta. Docs: https://www.afipts.com
> **Filosofía:** el creador NO almacena nada ni delega trámites. El comerciante genera su cert, su key, guarda su TA y factura desde su equipo. El backend es pasarela 100% stateless.

---

## 1. Principio rector

- El comerciante es dueño de TODO el circuito fiscal:
  - genera su cert (par key/cert) en su propio equipo (wizard),
  - lo guarda **cifrado en su SQLite local**,
  - su POS (Tauri) llama a ARCA vía la pasarela del creador **sin que el creador guarde nada**.
- Postgres del backend: **cero filas, cero columnas, cero tablas** nuevas por ARCA.
- El backend solo recibe en el body lo que necesita y muere con el request.

## 2. Arquitectura

```
[Desktop merchant] --HTTPS body completo--> [Backend Node: pasarela stateless] --> ARCA (wsaa/wsfe/padron)
  guarda: cert/key cifrados en SU SQLite local
  guarda: TA (Ticket de Acceso, 12h) en SU SQLite local
  guarda: CAE + nro comprobante en columnas de `venta` (su SQLite)
                        └── Postgres del creador: SIN cambios
```

- Modo SDK: **Manual credentials** — `new Arca({ cuit, cert, key, production, handleTicket: true, credentials })` por request. El backend NUNCA usa `FileSystemTicketStorage`.
- TA (12h) lo gestiona el **desktop**: lo obtiene con `/wsaa/login`, lo persiste en su SQLite (`arca_config.ta_json + ta_expira_en`) y lo reenvía en cada factura. Si expira o el backend responde `TA_EXPIRADA`, el desktop hace re-login 1 hit automático (ARCA limita 1 login cada 2 min en producción).

## 3. Fase A — Backend pasarela (`backend_panel_administracion`)

- **Dep nueva:** `@arcasdk/core` en `backend/package.json`.

**Nuevo módulo `backend/src/features/arca/`** (patrón `chat/`):

| Archivo | Contenido |
|---|---|
| `arca.dtos.ts` | zod: `WsaaLoginDTO {cuit, cert, key, production, service:'wsfe'}` · `WsfeFacturarDTO {credentials(ILoginCredentials), cuit, production, voucher}` (voucher: PtoVta, CbteTipo, Concepto, DocTipo/DocNro, CbteDesde/Hasta, CbteFch YYYYMMDD, ImpTotal/ImpNeto/ImpIVA/Iva[]) · `FeUltimoDTO {credentials, cuit, production, pto_vta, cbte_tipo}` · `PadronDTO {credentials, cuit_emisor, production, cuit_buscado}` |
| `arca.service.ts` | Por request: `new Arca({cuit, cert, key, production, handleTicket:true, credentials})`. Métodos: `login(wsaa)`, `facturar(wsfev1 createVoucher)`, `ultimoCbte(FECompUltimoAutorizado)`, `padronA4/A5`. Mapea `TA_EXPIRADA` → `{code:'TA_EXPIRADA'}`. |
| `arca.routes.ts` | `POST /api/arca/wsaa/login` · `POST /api/arca/wsfe/facturar` · `POST /api/arca/wsfe/ultimo-cbte` · `POST /api/arca/padron/alcance4` · `POST /api/arca/padron/alcance5` (registrar en `src/index.ts`). |

- **Logs:** jamás loguear body (contiene key). Sanitizar.
- **Prisma:** sin cambios. Config por body (`production` flag).

## 4. Fase B — Desktop (`sistema_desktop`)

### 4.1 Migración SQLite local
- Tabla `arca_config` (1 fila): `cuit, pto_vta, production, cert_cifrado BLOB, key_cifrado BLOB (AES local derivado del device), ta_json TEXT, ta_expira_en INTEGER, wsfe_autorizado, activa`
- `ALTER TABLE venta ADD cae TEXT, cae_fch_vto INTEGER, cbte_tipo INTEGER, cbte_nro INTEGER, resultado TEXT` (CAE NULL = pendiente)

### 4.2 Rust `src-tauri/src/arca.rs` (nuevo)
- Commands: `arca_config_guardar/obtener/activar`, `arca_probar_conexion`, `arca_regenerar_ta`, `arca_ultimo_cbte`, `arca_facturar_venta(venta_id)`.
- Guarda TA en `ta_json/ta_expira_en` y lo reenvía en cada pasada, re-login automático 1 tiro si `TA_EXPIRADA`.
- Facturación al confirmar venta: arma voucher desde la venta, sella `cae/cae_fch_vto/cbte_nro/resultado` en fila. Reintentos `MAX_INTENTOS 3`.

### 4.3 Wizard FE (`src/components/arca/`, patrón WizardBienvenida)
1. Elegir entorno Homologación / Producción.
2. Generación LOCAL de `key + CSR`: RSA-2048 PKCS#8/SHA-256, subject `CN=CUIT, serialNumber=CUIT`. Botón "Descargar CSR" + instrucciones literales de los tutoriales de afipts.
3. Pegar/arrastrar el `.crt` que ARCA devuelve + confirmar autorización WSFEv1 en el portal → `arca_probar_conexion` EN VIVO (homologación).
4. Configurar PtoVta + CbteTipos y activar `arca_config`.

### 4.4 Integración en el flujo de venta
- Tras confirmar venta, si `arca_config.activa`: resolver `CbteTipo` según condición del cliente (DocTipo 99 CF → FB 6; DocTipo 80 CUIT → A si resp. inscripto 1 / B 6 / C 11 según `usar_iva`), `arca_ultimo_cbte` para `CbteDesde/Hasta`, `facturar`, guardar `cae/...`.
- Si ARCA caído → venta queda en COLA PENDIENTE (cae NULL). Banner "N ventas pendientes de CAE" en Caja con botón reintentar. Checkout nunca se bloquea.

### 4.5 Padrones en `ClientesScreen`
- Al pegar CUIT (≥11 dígitos): chip "Consultar en ARCA" → `/padron/alcance4|alcance5` → autocompleta razón social y condición IVA.

## 5. Fase C — Verificación (Homologación / TESTING certs)

1. Tutorial afipts (testing): `enable-testing-certificates` → `obtain-testing-certificate` → `authorize-test-web-service` (3 pasos con CUIT real + clave fiscal, endpoints homologación).
2. Wizard → probar_conexion en homo → login + padrón propio OK.
3. Facturar venta homo → `Resultado: A` con CAE 10 días. `FECompUltimoAutorizado` correlativo.
4. Comprueba re-login/TA (reinicio reutiliza TA).
5. Test Padrón A4/A5 con CUIT real en homologación.
6. `npx tsc --noEmit` (backend + panel + frontend) y `cargo check` desktop.
7. Verificar logs sin body.

## 6. Riesgos / decisiones tomadas

| # | Decisión | Motivo |
|---|---|---|
| 1 | Backend pasarela, no almacenamiento | Cero filas ARCA en Postgres |
| 2 | Desktop cachea TA 12h | Evita rate-limit 1 login/2min producción |
| 3 | Cert/key cifradas local | Seguridad básica contra dump SQLite |
| 4 | `usar_iva='1'` pre-requisito FE | FE exige módulo IVA activo |
| 5 | PDF/QR fuera de iteración 1 | Acordado, queda para Phase 2 (`@arcasdk/pdf`) |

## 7. Fuera de scope (next iterations)
- PDF/QR del comprobante (`@arcasdk/pdf`).
- FECAEA (CAEA de contingencia) / WSFEX (exportación) / FECRED (MiPyME).
- Backup/exportar cert con password.

## 8. Estado del resto (contexto de la sesión)
- Todo previo está commiteado y pusheado en `mejoras-chat-optimizacion`: agente 10 pasos, herramientas nativas, override cupo Binny, cuota inyectada, escala de fuente, paleta de comandos, wizard marcas/categorías, etc.
- Al ejecutar este plan: commits en `mejoras-chat-optimizacion` de ambos repos.

## 9. Referencias
- SDK: https://www.afipts.com/basic-use.html · https://www.afipts.com/credential_management.html · https://github.com/ralcorta/arcasdk
- Tutoriales testing: `enable_testing_certificates`, `obtain-testing-certificate`, `authorize-test-web-service` y equivalentes de producción.
- WS: WSAA (auth 12h), WSFEv1 (factura), Padrones Alcance 4/5/10/13.

---
> Archivo generado para retomar en otro momento. No commiteado a propósito.
