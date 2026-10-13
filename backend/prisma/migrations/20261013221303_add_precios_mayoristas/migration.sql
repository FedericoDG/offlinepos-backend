-- CreateTable
CREATE TABLE "Cadena" (
    "id" TEXT NOT NULL,
    "cuit" TEXT NOT NULL,
    "id_comercio_sepa" INTEGER,
    "id_bandera_sepa" INTEGER,
    "razon_social" TEXT NOT NULL,
    "bandera_nombre" TEXT NOT NULL,
    "bandera_url" TEXT,
    "version_sepa" TEXT,
    "actualizado_sepa_en" TIMESTAMP(3),
    "importado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cadena_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SucursalCadena" (
    "id" TEXT NOT NULL,
    "cadena_id" TEXT NOT NULL,
    "id_sucursal" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT,
    "calle" TEXT,
    "numero" TEXT,
    "barrio" TEXT,
    "codigo_postal" TEXT,
    "localidad" TEXT,
    "provincia" TEXT,
    "latitud" DOUBLE PRECISION,
    "longitud" DOUBLE PRECISION,
    "observaciones" TEXT,
    "horarios" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SucursalCadena_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrecioMayorista" (
    "id" TEXT NOT NULL,
    "cadena_id" TEXT NOT NULL,
    "ean" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "marca" TEXT,
    "unidad_venta" TEXT,
    "precio_con_iva" DECIMAL(14,2) NOT NULL,
    "precio_sin_iva" DECIMAL(14,2) NOT NULL,
    "precio_bulto_con_iva" DECIMAL(14,2),
    "precio_bulto_sin_iva" DECIMAL(14,2),
    "precio_min" DECIMAL(14,2) NOT NULL,
    "precio_max" DECIMAL(14,2) NOT NULL,
    "sucursales" INTEGER NOT NULL,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrecioMayorista_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cadena_cuit_key" ON "Cadena"("cuit");

-- CreateIndex
CREATE UNIQUE INDEX "SucursalCadena_cadena_id_id_sucursal_key" ON "SucursalCadena"("cadena_id", "id_sucursal");

-- CreateIndex
CREATE INDEX "PrecioMayorista_ean_idx" ON "PrecioMayorista"("ean");

-- CreateIndex
CREATE INDEX "PrecioMayorista_descripcion_idx" ON "PrecioMayorista"("descripcion");

-- CreateIndex
CREATE UNIQUE INDEX "PrecioMayorista_cadena_id_ean_key" ON "PrecioMayorista"("cadena_id", "ean");

-- AddForeignKey
ALTER TABLE "SucursalCadena" ADD CONSTRAINT "SucursalCadena_cadena_id_fkey" FOREIGN KEY ("cadena_id") REFERENCES "Cadena"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrecioMayorista" ADD CONSTRAINT "PrecioMayorista_cadena_id_fkey" FOREIGN KEY ("cadena_id") REFERENCES "Cadena"("id") ON DELETE CASCADE ON UPDATE CASCADE;
