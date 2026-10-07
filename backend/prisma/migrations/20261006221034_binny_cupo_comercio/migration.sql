-- CreateTable
CREATE TABLE "chat_consumo_comercio" (
    "id" TEXT NOT NULL,
    "comercio_id" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "mensajes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_consumo_comercio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_consumo_comercio_comercio_id_periodo_key" ON "chat_consumo_comercio"("comercio_id", "periodo");

-- AddForeignKey
ALTER TABLE "chat_consumo_comercio" ADD CONSTRAINT "chat_consumo_comercio_comercio_id_fkey" FOREIGN KEY ("comercio_id") REFERENCES "Comercio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: el cupo pasa de ser por clave a ser por comercio. Se arranca el
-- contador del comercio con la suma del consumo ya registrado por sus claves
-- en cada periodo, para no regalar mensajes ya usados.
INSERT INTO "chat_consumo_comercio" ("id", "comercio_id", "periodo", "mensajes", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, l."comercio_id", c."periodo", SUM(c."mensajes"), now(), now()
FROM "ChatConsumo" c
JOIN "Licencia" l ON l."id" = c."licencia_id"
WHERE l."comercio_id" IS NOT NULL
GROUP BY l."comercio_id", c."periodo"
ON CONFLICT ("comercio_id", "periodo") DO NOTHING;
