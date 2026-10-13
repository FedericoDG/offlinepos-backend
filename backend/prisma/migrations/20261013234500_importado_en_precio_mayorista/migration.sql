-- SEPA publica los precios a diario: guardamos CUÁNDO los importamos, así Binny
-- puede decir a qué fecha corresponden (y el comerciante sabe si están frescos).
ALTER TABLE "PrecioMayorista"
  ADD COLUMN "importado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
