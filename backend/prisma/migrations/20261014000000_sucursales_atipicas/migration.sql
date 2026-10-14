-- Hay sucursales que publican un precio absurdo (un chocolate a 62 veces su
-- valor) y una sola de esas rompia la franja min/max de todo el producto.
-- Se guarda cuantas quedaron fuera, para poder avisarlo.
ALTER TABLE "PrecioMayorista"
  ADD COLUMN "sucursales_atipicas" INTEGER NOT NULL DEFAULT 0;
