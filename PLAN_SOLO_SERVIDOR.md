# Eliminar la licencia CLIENTE: solo Servidor (POS mono-instalación)

## Decisión del dueño
- Se elimina el TIPO de licencia "Cliente" en backend/panel Y en el Tauri.
- **Los terminales cliente desaparecen**: el POS queda mono-instalación (solo la
  instalación Servidor con su licencia). Se va TODO el modo cliente.

## Implicancias de datos (explícitas)
- Las licencias `rol = CLIENTE` existentes se **borran** (con sus activaciones y
  consumos por cascada). Sus terminales dejan de funcionar — es el objetivo.
- `Plan.max_clientes` deja de tener sentido → se elimina del modelo y del panel.
- En el SQLite del Tauri, la tabla `licencia` local tiene `rol`: se elimina la
  columna (o queda sin uso si SQLite no lo permite con seguridad).

## Ola 1 — backend/panel (`offlinepos-backend`)
- [ ] Prisma: `enum RolLicencia` sin CLIENTE + migración (borra licencias CLIENTE
      y recrea el tipo) + `Plan.max_clientes` fuera.
- [ ] `licencia.dtos.ts`, `licencia.panel.ts`, `licencia.service.ts`,
      `licencia.provision.ts` (cupo solo servidores, sync sin clientes),
      `comercio.dtos.ts`/`comercio.service.ts`, `plan.dtos.ts`/`plan.service.ts`,
      `suscripcion.service.ts` (select de max_clientes).
- [ ] Panel: fuera selector/filtros/badges de rol; alta de comercio con
      selección plana de claves; tipos y consultas.
- [ ] NO tocar: `usar_clientes` (módulo de clientes del comercio) ni el chat
      ("CLIENTE" como persona).

## Ola 2 — Tauri (`sistema_desktop`)
- [ ] Fuera `cliente_api.rs` y `servidor_api.rs` (verificar antes si el servidor
      API sirve algo más, p.ej. sesión móvil: si sirve, extraer esa parte).
- [ ] `lib.rs`: quitar guards `es_modo_cliente`, comando `guardar_servidor_url`.
- [ ] `licencia.rs`: fuera `CONFIG_SERVIDOR_URL` y el `rol` del estado/token
      (mantener `usar_clientes`, que es el módulo de clientes del comercio).
- [ ] Frontend: fuera `ConfigurarServidorScreen`, `HomeClienteScreen` y sus rutas.
- [ ] Migración local: columna `rol` de `licencia`.
- [ ] Verificación: `cargo test --lib` + harness de simulación (no debe romper).

## Verificación por ola
- Backend: `tsc` + `next build` + migración aplicada + smoke (generar clave sin
  rol, alta de comercio, activación).
- Tauri: `cargo test --lib` + simulación 5 días.
