# Panel de administracion (Next.js 16).
#
# Habla con el backend SOLO del lado servidor via BACKEND_URL
# (ver panel/src/lib/api.ts); esa variable llega en runtime por compose,
# no se hornea en la imagen. `next start` sirve en el puerto 3000.

# ---- deps: instala dependencias (capa cacheable) ----
FROM node:22-alpine AS deps
WORKDIR /app/panel
COPY panel/package.json panel/package-lock.json ./
RUN npm ci

# ---- build: compila Next (necesita mas memoria: ver NODE_OPTIONS) ----
FROM node:22-alpine AS build
WORKDIR /app/panel
ENV NODE_OPTIONS=--max-old-space-size=1536
COPY --from=deps /app/panel/node_modules ./node_modules
COPY panel/ ./
RUN npm run build

# ---- runtime: produccion minima (sin devDependencies) ----
FROM node:22-alpine AS runtime
WORKDIR /app/panel
ENV NODE_ENV=production
COPY panel/package.json panel/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/panel/.next ./.next
COPY --from=build /app/panel/public ./public
COPY --from=build /app/panel/next.config.ts ./next.config.ts
EXPOSE 3000
CMD ["npm", "start"]
