-- pg_trgm: tolera errores de tipeo y permite rankear por similitud.
-- `IF NOT EXISTS` para que la migración sea segura si ya está.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Texto normalizado para buscar (minúsculas, sin acentos, unidades separadas).
-- Lo calcula la ingesta; guardarlo evita normalizar 10.000 descripciones en
-- cada consulta.
ALTER TABLE "PrecioMayorista" ADD COLUMN "texto_busqueda" TEXT;

-- La búsqueda usa LIKE '%token%', que un índice btree no puede aprovechar;
-- uno de trigramas sí.
CREATE INDEX "PrecioMayorista_texto_busqueda_idx"
  ON "PrecioMayorista" USING gin ("texto_busqueda" gin_trgm_ops);
