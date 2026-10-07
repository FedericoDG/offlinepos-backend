# Administración directa en el backend del Tauri (licencias intactas)

## Objetivo
Que dar de alta un cliente del POS Tauri sea VAGATÍVAMENTE "en un paso":
crear comercio → asignar plan (cupo de servidores/clientes/consultas) →
emitir licencia con la clave lista para entregar. Suscripciones/pagos quedan
como opcionales; NADA del modelo de licencias/activaciones cambia.

## Por qué
El dueño administra el POS Web directo y el Tauri enredado (licencia +
suscripción + pago + cupo resuelto en 3 capas). Se tengamos los mismos
capitales del mantenimiento a mano (Web=Planes directo ✓), portemós el
ESPÍRITU, no un modelo nuevo: licencia SFunctional, cupo desde el plan
asignado al comercio.

## Autorización
- Usuario eligió 'Directo en el backend Tauri' (2026-10-06).
- Repo base: /home/federico/Escritorio/POS/backend_panel_administracion,
  branch main, limpio (root del web POS al lado, NO se toca).

## Diseño (decisiones del orquestador)
- **Comercio.plan_id (FK a Plan, nullable) + columnas de cupo NO nuevas**:
  el Plan ya tiene max_servidores/max_clientes/chat_mensajes_mes.
- **Cupo resuelve**: Comercio.chat_mensajes_override ||
  Comercio.plan.chat_mensajes_mes || Suscripcion activa→Plan (back-compat)
  || env (CHAT_MENSAJES_MES 400).
- **verificarCupoDisponible** lee el cupo de Comercio.plan al igual que hoy
  de la Suscripcion; no rompe comercios con suscripción (fallback).
- **Endpoint nuevo POST /api/comercios/alta-directa** {nombre, plan_id}:
  crea Comercio con plan y replica el TX de primera licencia
  (sincronizarLicenciasConPlan reutilizado), devolviendo claves para entregar.
- **Panel**: pantalla 'Nuevo comercio (directo)' con {nombre, plan} +
  acción emitir-licencia, llamando al endpoint novo vía server actions.
- Suscripciones/pagos/planes: quedan SOS Prairie opcionales (nadie se rompe).

## Archivos
- backend/prisma/schema.prisma (+ migración SQL para Comercio.plan_id)
- backend/src/features/comercio/ (endpoint alta directa)
- backend/src/features/licencia/licencia.provision.ts (cupo con fallback)
- backend/src/features/chat/chat.service.ts:68-94 (resolución de límite)
- panel/src/app/(panel)/comercios/ (screen directo) + actions/comercios.ts
- NO tocar: activación/Ed25519/instalacion_id, sistema_desktop (mkdir sin cambios)

## Tareas
- [ ] D1: schema + migración (Comercio.plan_id)
- [ ] D2: endpoint alta-directa + cupo fallback en provision/chat
- [ ] D3: pantalla+acción del panel
- [ ] D4: verificación (tsc backend + panel build) — sin commit (repo del
      backend Tauri queda para revisión del dueño)
