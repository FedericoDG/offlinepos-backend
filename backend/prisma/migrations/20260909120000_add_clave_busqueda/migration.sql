-- AlterTable
ALTER TABLE "Licencia" ADD COLUMN     "clave_busqueda" TEXT;
CREATE UNIQUE INDEX "Licencia_clave_busqueda_key" ON "Licencia"("clave_busqueda");
