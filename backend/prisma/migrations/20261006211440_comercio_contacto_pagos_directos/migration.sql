-- AlterTable
ALTER TABLE "Comercio" ADD COLUMN     "email" TEXT,
ADD COLUMN     "telefono" TEXT;

-- AlterTable
ALTER TABLE "Pago" ADD COLUMN     "comercio_id" TEXT,
ALTER COLUMN "suscripcion_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Pago_comercio_id_idx" ON "Pago"("comercio_id");

-- AddForeignKey
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_comercio_id_fkey" FOREIGN KEY ("comercio_id") REFERENCES "Comercio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
