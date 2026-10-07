# FEATURE — CD automático POS Offline a VPS (backend + panel)

**Fecha:** 2026-10-07 · **Estado:** en progreso
**Repos:** `offlinepos-backend` (este repo) + `vps-nginx` (nginx ya en producción con CD)

## Objetivo
Push/merge a `main` de este repo → Action de GitHub → build de imágenes en el VPS → stack `postgres + backend + panel` corriendo en la red `vps-net`, servido por el nginx existente vía 2 vhosts nuevos con TLS automático (ACME nativo).

## Problemática
No hay nada de producción en el repo: `dev.yml` solo levanta Postgres de desarrollo; no existen Dockerfiles, compose de producción, workflow de CI ni .env de prod. Toda pieza se crea de cero.

## Decisiones
- **Build de imágenes en el VPS** (sin registry; next build consume RAM ahí cada deploy).
- **Postgres gestionado en Neon** (neon.com): `DATABASE_URL` apunta allá; *sin* contenedor Postgres en el stack. Verificar extensión `postgis` en el proyecto Neon si el schema la usa realmente (el dev.yml llevaba imagen postgis).
- Red: la **externa `vps-net`** (ya creada por vps-nginx; external: true). Cero `ports:` — solo nginx expone 80/443 (C1 de vps-nginx).
- Secretos en el VPS (`/root/apps/offlinepos/`), nunca en el repo (patrón acme-state). **Incluye `DATABASE_URL` de Neon**.
- Neon requiere `?sslmode=require` en la cadena; migraciones corren contra la DB remota.
- Migraciones: `prisma migrate deploy` en el deploy script (antes del up). Ojo: la migración `20261007120000` **borra licencias CLIENTE** — apunta a la DB real de Neon; confirmar que la URL usada sea prod, no dev.
- Deploy key SSH **nueva y dedicada** para este repo (`id_deploy_offlinepos`); secretos de Action: `SSH_PRIVATE_KEY`, `SSH_HOST`.

## Tareas
| ID | Task | Estado |
|----|------|--------|
| T1 | Dockerfiles backend/panel + .dockerignore | done (backend/Dockerfile y panel/Dockerfile multi-stage node:22-alpine; .dockerignore en raiz; ambas imagenes compilan: `docker build` OK) |
| T2 | `compose.prod.yml` (red externa vps-net, sin puertos, sin Postgres) | done (panel-backend + panel-web, volumen pos-updates en /app/updates, env_file a deploy/env/*.env; `docker compose config` OK con stubs) |
| T3 | Workflow Actions push→main (SSH, patrón vps-nginx) + `scripts/deploy.sh` | done (.github/workflows/deploy.yml replica patron vps-nginx, grupo deploy-pos; deploy.sh POSIX con migrate + health /health y /; `sh -n` OK, workflow YAML OK) |
| T4 | `deploy/.env.production.example` (nombres de vars, sin secretos) | done (todas las vars de env.ts + BACKEND_URL/SESSION_COOKIE_NAME/DIAS_GRACIA, placeholder Neon sslmode=require; `git grep secret/password` sin matches) |
| T5 | Env de prod real en el VPS (secreto, incluye DATABASE_URL de Neon) — necesita autorización SSH | pending |
| T6 | Vhosts `20-posapi.conf` + `21-pospanel.conf` en repo vps-nginx + DNS DuckDNS (usuario) | pending |
| T7 | Secrets de Action en GitHub (usuario) + primer despliegue + verificación end-to-end | pending |

## Criterios de aceptación
- Push a main → Action verde → `curl https://pospanel-binario.duckdns.org/` y `curl https://posapi-binario.duckdns.org/` responden con TLS válido sin `-k`.
- `docker ps` en VPS muestra postgres/backend/panel en `vps-net` sin puertos publicados.
- `prisma migrate deploy` corrió; volumen de la DB persiste tras down/up.
- Ningún secreto en el repo (chequeo: `git grep -i secret/password` limpio).

## Verificación de la sesión
- 2026-10-07 (T1–T4): `docker build -f backend/Dockerfile .` OK (prisma generate + tsc dentro de la imagen); `docker build -f panel/Dockerfile .` OK (next build con NODE_OPTIONS=1536m); `docker compose -f compose.prod.yml config` OK (con stubs temporales en /tmp: env_files reales solo existen en el VPS); `sh -n scripts/deploy.sh` OK; workflow YAML parse OK via pyyaml; `git grep -nE "senha|password|secret" deploy/.env.production.example` sin matches (placeholders <REPLACE_ME...> en mayusculas, sin minusculas sensibles). Salud backend verificada contra ruta real GET /health (backend/src/index.ts:103, responde SELECT 1 a Postgres); deploy.sh usa /health y / para panel. Quedan T5–T7 (VPS, DNS, secrets de Action) que requieren acceso/usuario.

## Notas
- RAM del VPS a verificar antes del primer build (next build pesa; si hace falta, swap).
- Patrón por-rol ya preparado: la Action de este repo replica la experiencia de vps-nginx.
