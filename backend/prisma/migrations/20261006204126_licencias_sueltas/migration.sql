-- DropForeignKey
ALTER TABLE "Licencia" DROP CONSTRAINT "Licencia_comercio_id_fkey";

-- AlterTable
ALTER TABLE "Licencia" ALTER COLUMN "comercio_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Licencia" ADD CONSTRAINT "Licencia_comercio_id_fkey" FOREIGN KEY ("comercio_id") REFERENCES "Comercio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
