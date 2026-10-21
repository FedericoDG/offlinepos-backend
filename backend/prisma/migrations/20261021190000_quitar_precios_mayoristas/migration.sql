-- Quita la feature de Precios Mayoristas (SEPA).
-- Son dumps importados (~600k filas), no datos del comercio.
DROP TABLE "PrecioSucursal";
DROP TABLE "PrecioMayorista";
DROP TABLE "SucursalCadena";
DROP TABLE "Cadena";
