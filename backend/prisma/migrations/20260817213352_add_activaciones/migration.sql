-- CreateTable
CREATE TABLE "Activacion" (
    "id" TEXT NOT NULL,
    "licencia_id" TEXT NOT NULL,
    "instalacion_id" TEXT NOT NULL,
    "ultima_validacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Activacion_licencia_id_instalacion_id_key" ON "Activacion"("licencia_id", "instalacion_id");

-- AddForeignKey
ALTER TABLE "Activacion" ADD CONSTRAINT "Activacion_licencia_id_fkey" FOREIGN KEY ("licencia_id") REFERENCES "Licencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;
