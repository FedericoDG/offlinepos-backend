-- AlterTable
ALTER TABLE "Comercio" ADD COLUMN     "plan_id" TEXT;

-- CreateIndex
CREATE INDEX "Comercio_plan_id_idx" ON "Comercio"("plan_id");

-- AddForeignKey
ALTER TABLE "Comercio" ADD CONSTRAINT "Comercio_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
