-- La cadena pasa a identificarse por (CUIT, bandera): `comercio.csv` trae una
-- fila por bandera y un mismo comercio puede publicar varias con precios
-- distintos (ej. Carrefour Market y Express).
DROP INDEX "Cadena_cuit_key";

ALTER TABLE "Cadena" ALTER COLUMN "id_bandera_sepa" SET NOT NULL;

CREATE UNIQUE INDEX "Cadena_cuit_id_bandera_sepa_key" ON "Cadena"("cuit", "id_bandera_sepa");

-- `productos_ean` del dump: true = el código es un EAN real, false = es un
-- código interno del comercio (solo los reales se cruzan por código de barras).
ALTER TABLE "PrecioMayorista" ADD COLUMN "es_ean" BOOLEAN NOT NULL DEFAULT true;
