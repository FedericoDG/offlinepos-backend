#!/bin/sh
# Las comprobaciones que tienen que pasar antes de que algo llegue a main
# (build.yml) y antes de que deploy.yml despliegue. Vive en un solo lugar para
# que la puerta del deploy y el CI no se separen nunca.
#
# Corre en el runner de GitHub tal cual: sin red mas alla de construir la
# imagen, sin base de datos (las suites usan una base en memoria) y sin daemon
# para la primera comprobacion (el script de deploy se prueba con un docker
# falso).
set -e

RAIZ=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$RAIZ"

echo "==> pruebas del script de deploy (con un docker falso, sin tocar el stack)"
sh scripts/prueba-deploy-preflight.sh

# La etapa `build` del Dockerfile ya trae node_modules, el codigo fuente y las
# pruebas, con el node de la imagen: no hay que instalar nada.
echo "==> imagen de pruebas del backend"
docker build --target build --file backend/Dockerfile --tag ci-backend-pruebas .

echo "==> suite de logica del backend"
docker run --rm ci-backend-pruebas npx tsx pruebas/correr.ts

echo "==> regresion del error del OCR de facturas"
docker run --rm ci-backend-pruebas node --experimental-test-module-mocks --import tsx --test pruebas/factura-ocr-error.prueba.ts

# Las cuatro de abajo necesitan lo mismo que la suite: que config/env.ts valide
# al importarse. Por eso importan backend/pruebas/entorno.ts como primer import.
echo "==> evaluacion del modo guia de Binny (recuperacion del manual + prompt)"
docker run --rm ci-backend-pruebas npx tsx scripts/evaluar-guia.mts

echo "==> pre-chequeo de memoria de Binny"
docker run --rm ci-backend-pruebas npx tsx scripts/prueba-memoria-prechequeo.mts

echo "==> regresion de bloques de creacion"
docker run --rm ci-backend-pruebas npx tsx scripts/regresion-bloques.mts

echo "==> medicion del prompt"
docker run --rm ci-backend-pruebas npx tsx scripts/medir-prompt.mts

echo "TODO OK"
