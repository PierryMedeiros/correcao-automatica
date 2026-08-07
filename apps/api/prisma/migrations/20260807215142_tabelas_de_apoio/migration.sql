-- CreateTable
CREATE TABLE "eventos" (
    "id" BIGSERIAL NOT NULL,
    "submissao_id" BIGINT,
    "tipo" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "ts" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacoes" (
    "id" BIGSERIAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "lida" BOOLEAN NOT NULL DEFAULT false,
    "link" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notificacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_payloads" (
    "id" BIGSERIAL NOT NULL,
    "headers" JSONB NOT NULL,
    "body" TEXT NOT NULL,
    "ts" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_payloads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config" (
    "chave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,
    "descricao" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "config_pkey" PRIMARY KEY ("chave")
);

-- CreateIndex
CREATE INDEX "eventos_submissao_id_ts_idx" ON "eventos"("submissao_id", "ts");

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_submissao_id_fkey" FOREIGN KEY ("submissao_id") REFERENCES "submissoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
