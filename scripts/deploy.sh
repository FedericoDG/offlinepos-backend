#!/bin/sh
# Despliegue en el VPS. Lo ejecuta la Action de GitHub DESPUES de
# `git fetch origin && git reset --hard origin/main` en /root/apps/offlinepos.
# Shell POSIX puro (corre con `bash scripts/deploy.sh` o `sh`).
#
# Orden pensado para no dejar produccion caida:
#   1. build
#   2. pre-flight: la imagen NUEVA se levanta en un contenedor aparte y se le
#      corre el MISMO probe que despues del swap. Si no arranca, se corta aca y
#      el stack que esta sirviendo no se toca.
#   3. migraciones Prisma
#   4. swap con --wait
#   5. health checks sobre el stack ya cambiado
#
# El pre-flight levanta el contenedor con `compose run`, NO con `docker run
# --env-file`: compose le saca las comillas a los valores del env_file y
# `docker run` no, asi que con `docker run` el backend moria con
# "[Config Error]: LLM_BASE_URL debe ser una URL valida" y el deploy no pasaba
# nunca. Con `compose run` el pre-flight ve exactamente el mismo entorno que el
# deploy real.
#
# Por que NO hay rollback automatico: `prisma migrate deploy` corre antes del
# swap, asi que volver a la imagen anterior dejaria el codigo viejo contra una
# base ya migrada. Un rollback que no revierte la migracion es una falsa
# tranquilidad; el pre-flight evita tener que llegar a ese punto.
set -e

COMPOSE="docker compose -f compose.prod.yml"

# Nombres temporales del pre-flight: no pisan los de produccion y se borran
# siempre, incluso si el script corta a la mitad (ver el trap).
PF_BACKEND=pf-offlinepos-backend
PF_PANEL=pf-offlinepos-panel
PF_LANDING=pf-offlinepos-landing

limpiar() {
  docker rm -f "$PF_BACKEND" "$PF_PANEL" "$PF_LANDING" >/dev/null 2>&1 || true
}
trap limpiar EXIT

# Levanta el contenedor de prueba, espera a que el probe responda y lo borra.
# Si el contenedor se apaga solo, corta ahi mismo: ese es el caso que importa
# (arranca y crashea) y sin este chequeo habria que esperar los 60 segundos.
# $1 nombre temporal | $2 comando que lo levanta | $3 comando del probe
preflight() {
  nombre=$1
  arranque=$2
  probe=$3

  docker rm -f "$nombre" >/dev/null 2>&1 || true

  if ! sh -c "$arranque" >/dev/null 2>&1; then
    echo "    no se pudo levantar el contenedor de prueba"
    docker logs --tail 20 "$nombre" 2>&1 | sed 's/^/      /'
    return 1
  fi

  intentos=0
  while [ "$intentos" -lt 12 ]; do
    if ! docker inspect -f '{{.State.Running}}' "$nombre" 2>/dev/null | grep -qx true; then
      echo "    la imagen nueva se apago sola. Ultimas lineas del log:"
      docker logs --tail 20 "$nombre" 2>&1 | sed 's/^/      /'
      return 1
    fi
    if docker exec "$nombre" sh -c "$probe" >/dev/null 2>&1; then
      echo "    responde bien"
      docker rm -f "$nombre" >/dev/null 2>&1 || true
      return 0
    fi
    intentos=$((intentos + 1))
    sleep 5
  done

  echo "    no respondio despues de 60 segundos. Ultimas lineas del log:"
  docker logs --tail 20 "$nombre" 2>&1 | sed 's/^/      /'
  return 1
}

# Un dump comprimido ANTES de migrar. Instrucciones de restauracion en
# $DIR_RESPALDOS/LEEME.txt, que es donde alguien las va a buscar.
respaldar() {
  mkdir -p "$DIR_RESPALDOS"
  archivo="offlinepos-$(date +%Y%m%d-%H%M%S).dump"

  if ! $COMPOSE --profile herramientas run --rm --no-deps respaldos \
    sh -c "pg_dump \"\$DATABASE_URL\" --format=custom --file=/respaldos/$archivo"; then
    echo "    pg_dump fallo"
    return 1
  fi

  # Un dump de 0 bytes parece un respaldo y no lo es.
  if [ ! -s "$DIR_RESPALDOS/$archivo" ]; then
    echo "    el respaldo quedo vacio: $DIR_RESPALDOS/$archivo"
    return 1
  fi

  echo "    $(du -h "$DIR_RESPALDOS/$archivo" | cut -f1) -> $DIR_RESPALDOS/$archivo"

  if [ ! -f "$DIR_RESPALDOS/LEEME.txt" ]; then
    cat > "$DIR_RESPALDOS/LEEME.txt" <<'LEEME'
Respaldo de la base de produccion de AIPOS, hecho por scripts/deploy.sh antes de
cada `prisma migrate deploy`.

Restaurar PISA la base actual. Revisar antes de correrlo:
  cd /root/apps/offlinepos
  docker compose --profile herramientas run --rm --no-deps respaldos \
    sh -c 'pg_restore --clean --if-exists --dbname="$DATABASE_URL" /respaldos/<archivo>'

Se conservan los de los ultimos 14 dias (DIAS_DE_RESPALDO en scripts/deploy.sh).
LEEME
  fi

  # El respaldo recien hecho siempre queda: la rotacion solo borra los viejos.
  find "$DIR_RESPALDOS" -name 'offlinepos-*.dump' -mtime "+$DIAS_DE_RESPALDO" -delete 2>/dev/null || true
  return 0
}

PROBE_BACKEND="node -e \"require('http').get('http://127.0.0.1:'+(process.env.PORT||'4000')+'/health/db',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))\""
PROBE_PANEL="node -e \"require('http').get('http://127.0.0.1:3000/admin',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))\""
PROBE_LANDING="wget -qO- http://127.0.0.1/ >/dev/null"

# Overridable para poder probar el script sin escribir en /root (ver
# scripts/prueba-deploy-preflight.sh).
DIR_RESPALDOS=${DIR_RESPALDOS:-/root/respaldos-offlinepos}
# Neon guarda historial para instant restore, pero en el plan Free son 6 HORAS:
# una migracion mala descubierta al dia siguiente no tiene a donde volver. Por
# eso el respaldo se retiene por tiempo y no por cantidad.
DIAS_DE_RESPALDO=${DIAS_DE_RESPALDO:-14}

echo "==> build de imagenes"
$COMPOSE build

echo "==> pre-flight backend: la imagen nueva responde antes de tocar lo que sirve"
if ! preflight "$PF_BACKEND" "$COMPOSE run -d --name $PF_BACKEND --no-deps panel-backend" "$PROBE_BACKEND"; then
  echo "PRE-FLIGHT_FALLO (backend): el stack en pie NO se toco."
  exit 1
fi

echo "==> pre-flight panel"
if ! preflight "$PF_PANEL" "$COMPOSE run -d --name $PF_PANEL --no-deps panel-web" "$PROBE_PANEL"; then
  echo "PRE-FLIGHT_FALLO (panel): el stack en pie NO se toco."
  exit 1
fi

echo "==> pre-flight landing"
if ! preflight "$PF_LANDING" "$COMPOSE run -d --name $PF_LANDING --no-deps landing" "$PROBE_LANDING"; then
  echo "PRE-FLIGHT_FALLO (landing): el stack en pie NO se toco."
  exit 1
fi

echo "==> respaldo de la base antes de migrar (plan Free de Neon: historial de 6 horas)"
if ! respaldar; then
  echo "RESPALDO_FALLO: no se migro nada. El stack en pie NO se toco."
  exit 1
fi

echo "==> migraciones Prisma contra Neon (DATABASE_URL viene del env_file)"
$COMPOSE run --rm panel-backend npx prisma migrate deploy

echo "==> levantar stack (--wait: no lo da por bueno hasta que este sano)"
$COMPOSE up -d --remove-orphans --wait --wait-timeout 180

echo "==> espera de arranque"
sleep 5

echo "==> health backend (GET /health/db, verifica Postgres; /health es solo liveness)"
$COMPOSE exec -T panel-backend node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||'4000')+'/health/db',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

echo "==> health panel (GET /)"
$COMPOSE exec -T panel-web node -e "require('http').get('http://127.0.0.1:3000/admin',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

echo "==> health landing (GET /)"
$COMPOSE exec -T landing wget -qO- http://127.0.0.1/ >/dev/null

echo "DEPLOY_OK $(git rev-parse --short HEAD)"
