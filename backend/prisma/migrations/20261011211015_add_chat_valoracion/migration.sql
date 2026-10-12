-- CreateTable
CREATE TABLE "ChatValoracion" (
    "id" TEXT NOT NULL,
    "licencia_id" TEXT NOT NULL,
    "comercio_id" TEXT,
    "valoracion" INTEGER NOT NULL,
    "pregunta" TEXT NOT NULL,
    "respuesta" TEXT NOT NULL,
    "fuente" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatValoracion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatValoracion_comercio_id_idx" ON "ChatValoracion"("comercio_id");

-- CreateIndex
CREATE INDEX "ChatValoracion_licencia_id_idx" ON "ChatValoracion"("licencia_id");

-- CreateIndex
CREATE INDEX "ChatValoracion_creado_en_idx" ON "ChatValoracion"("creado_en");

-- AddForeignKey
ALTER TABLE "ChatValoracion" ADD CONSTRAINT "ChatValoracion_licencia_id_fkey" FOREIGN KEY ("licencia_id") REFERENCES "Licencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatValoracion" ADD CONSTRAINT "ChatValoracion_comercio_id_fkey" FOREIGN KEY ("comercio_id") REFERENCES "Comercio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
