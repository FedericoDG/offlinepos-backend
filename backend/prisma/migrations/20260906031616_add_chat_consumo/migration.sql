-- CreateTable
CREATE TABLE "ChatConsumo" (
    "id" TEXT NOT NULL,
    "licencia_id" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "mensajes" INTEGER NOT NULL DEFAULT 0,
    "prompt_tokens" BIGINT NOT NULL DEFAULT 0,
    "completion_tokens" BIGINT NOT NULL DEFAULT 0,
    "total_tokens" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatConsumo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatConsumo_licencia_id_periodo_key" ON "ChatConsumo"("licencia_id", "periodo");

-- AddForeignKey
ALTER TABLE "ChatConsumo" ADD CONSTRAINT "ChatConsumo_licencia_id_fkey" FOREIGN KEY ("licencia_id") REFERENCES "Licencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;
