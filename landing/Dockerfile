# Imagen de la landing de AIPOS: build estático con Astro + nginx sirviendo el
# resultado. El contexto de build es la RAÍZ del repo (ver compose.prod.yml),
# por eso las rutas empiezan con `landing/`.
#
# Node 24 para que coincida con la versión con la que se construye y prueba en
# desarrollo: menos sorpresas entre lo que ves local y lo que sale en el VPS.

FROM node:24-alpine AS build
WORKDIR /app
COPY landing/package.json landing/package-lock.json ./
RUN npm ci
COPY landing/ ./
RUN npm run build

FROM nginx:1.29-alpine
COPY landing/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Sirve para el health check del deploy (y para docker ps).
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
