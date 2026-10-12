-- CreateTable
CREATE TABLE "chat_valoracion_resumen" (
    "id" TEXT NOT NULL,
    "comercio_id" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "positivas" INTEGER NOT NULL DEFAULT 0,
    "negativas" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_valoracion_resumen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_valoracion_resumen_comercio_id_periodo_key" ON "chat_valoracion_resumen"("comercio_id", "periodo");

-- AddForeignKey
ALTER TABLE "chat_valoracion_resumen" ADD CONSTRAINT "chat_valoracion_resumen_comercio_id_fkey" FOREIGN KEY ("comercio_id") REFERENCES "Comercio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
