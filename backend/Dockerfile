# Backend POS offline (Express + TypeScript + Prisma).
#
# Layout importante: el codigo resuelve el .env de la RAIZ del repo
# (src/config/env.ts hace path.resolve(__dirname, '../../../.env')) y la
# carpeta de instaladores `updates/` tambien vive en la raiz del repo.
# Por eso el WORKDIR final es /app/backend pero el volumen de updates se
# monta en /app/updates (dist/... resuelve ../../../../updates -> /app/updates).
#
# Etapa runtime: conserva node_modules COMPLETO (incluye la CLI de prisma,
# necesaria para `prisma migrate deploy` en scripts/deploy.sh).

# ---- deps: instala dependencias (capa cacheable) ----
FROM node:22-alpine AS deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

# ---- build: genera el cliente Prisma y compila TypeScript ----
FROM node:22-alpine AS build
WORKDIR /app/backend
COPY --from=deps /app/backend/node_modules ./node_modules
COPY backend/ ./
RUN npx prisma generate && npm run build

# ---- runtime: solo lo necesario para correr + migrar ----
FROM node:22-alpine AS runtime
WORKDIR /app/backend
ENV NODE_ENV=production
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/prisma ./prisma
COPY --from=build /app/backend/package.json ./package.json
EXPOSE 4000
# /health existe en backend/src/index.ts (verifica Postgres con SELECT 1).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||'4000')+'/health',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/index.js"]
