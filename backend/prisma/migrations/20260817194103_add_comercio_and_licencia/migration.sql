-- CreateTable
CREATE TABLE "Comercio" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comercio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Licencia" (
    "id" TEXT NOT NULL,
    "comercio_id" TEXT NOT NULL,
    "clave_hash" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'activa',
    "activado_en" TIMESTAMP(3),
    "max_activaciones" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Licencia_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Licencia" ADD CONSTRAINT "Licencia_comercio_id_fkey" FOREIGN KEY ("comercio_id") REFERENCES "Comercio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
