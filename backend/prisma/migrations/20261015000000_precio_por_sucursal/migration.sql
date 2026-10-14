-- El precio de cada producto EN CADA sucursal.
--
-- La franja (min/max) no alcanza para decidir una compra: el comerciante compra
-- en UNA sucursal, la que le queda cerca, y necesita saber a cuanto esta ahi.
-- El dump real trae ~400.000 de estas filas contra 41.129 productos agregados.
CREATE TABLE "PrecioSucursal" (
  "id"              TEXT         NOT NULL,
  "cadena_id"       TEXT         NOT NULL,
  "ean"             TEXT         NOT NULL,
  "id_sucursal"     TEXT         NOT NULL,
  "precio_con_iva"  DECIMAL(14,2) NOT NULL,
  "precio_sin_iva"  DECIMAL(14,2) NOT NULL,
  "actualizado_en"  TIMESTAMP(3) NOT NULL,
  "importado_en"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PrecioSucursal_pkey" PRIMARY KEY ("id")
);

-- Detalle de un producto (cadena + ean) y, de paso, el reemplazo por cadena.
CREATE UNIQUE INDEX "PrecioSucursal_cadena_id_ean_id_sucursal_key"
  ON "PrecioSucursal"("cadena_id", "ean", "id_sucursal");

ALTER TABLE "PrecioSucursal"
  ADD CONSTRAINT "PrecioSucursal_cadena_id_fkey"
  FOREIGN KEY ("cadena_id") REFERENCES "Cadena"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- La importación reemplaza todo lo de una cadena: sin esto, el DELETE de una
-- cadena con 160.000 filas hace un recorrido completo de la tabla.
CREATE INDEX "PrecioSucursal_cadena_id_idx" ON "PrecioSucursal"("cadena_id");
