#!/bin/sh
# Despliegue en el VPS. Lo ejecuta la Action de GitHub DESPUES de
# `git fetch origin && git reset --hard origin/main` en /root/apps/offlinepos.
# Shell POSIX puro (corre con `bash scripts/deploy.sh` o `sh`).
set -e

COMPOSE="docker compose -f compose.prod.yml"

echo "==> build de imagenes"
$COMPOSE build

echo "==> migraciones Prisma contra Neon (DATABASE_URL viene del env_file)"
$COMPOSE run --rm panel-backend npx prisma migrate deploy

echo "==> levantar stack"
$COMPOSE up -d --remove-orphans

echo "==> espera de arranque"
sleep 5

echo "==> health backend (GET /health, ruta verificada en backend/src/index.ts)"
$COMPOSE exec -T panel-backend node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||'4000')+'/health',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

echo "==> health panel (GET /)"
$COMPOSE exec -T panel-web node -e "require('http').get('http://127.0.0.1:3000/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

echo "DEPLOY_OK $(git rev-parse --short HEAD)"
