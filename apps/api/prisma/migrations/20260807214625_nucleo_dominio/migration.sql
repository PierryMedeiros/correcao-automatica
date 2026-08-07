-- CreateEnum
CREATE TYPE "origem_submissao" AS ENUM ('manual', 'fc_platform');

-- CreateEnum
CREATE TYPE "status_submissao" AS ENUM ('recebida', 'validando', 'na_fila', 'corrigindo', 'aguardando_revisao', 'pronta_envio', 'enviada', 'link_invalido', 'sem_skill', 'erro', 'cancelada', 'substituida');

-- CreateEnum
CREATE TYPE "status_correcao" AS ENUM ('rodando', 'concluida', 'falhou', 'timeout', 'nao_executada');

-- CreateEnum
CREATE TYPE "veredito" AS ENUM ('aprovado', 'aprovado_com_observacao', 'reprovado', 'inconclusivo');

-- CreateEnum
CREATE TYPE "politica_revisao" AS ENUM ('todas', 'so_reprovadas', 'nenhuma');

-- CreateEnum
CREATE TYPE "status_run" AS ENUM ('ativo', 'pausado', 'finalizado', 'cancelado');

-- CreateTable
CREATE TABLE "runs" (
    "id" BIGSERIAL NOT NULL,
    "modelo" TEXT NOT NULL,
    "max_paralelo" INTEGER NOT NULL DEFAULT 2,
    "politica_revisao" "politica_revisao" NOT NULL,
    "status" "status_run" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissoes" (
    "id" BIGSERIAL NOT NULL,
    "origem" "origem_submissao" NOT NULL,
    "external_id" TEXT,
    "run_id" BIGINT,
    "aluno_nome" TEXT NOT NULL,
    "aluno_email" TEXT NOT NULL,
    "projeto" TEXT NOT NULL,
    "fase" TEXT NOT NULL,
    "skill_slug" TEXT,
    "repo_url" TEXT NOT NULL,
    "commit_sha" TEXT,
    "attempt_aluno" INTEGER NOT NULL DEFAULT 1,
    "anterior_id" BIGINT,
    "status" "status_submissao" NOT NULL,
    "status_detalhe" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "submissoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correcoes" (
    "id" BIGSERIAL NOT NULL,
    "submissao_id" BIGINT NOT NULL,
    "retry_n" INTEGER NOT NULL,
    "status" "status_correcao" NOT NULL,
    "veredito" "veredito",
    "dossie" JSONB,
    "gatilhos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "modelo" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "duracao_s" INTEGER,
    "transcript_path" TEXT NOT NULL,
    "exit_code" INTEGER,
    "erro_resumo" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "correcoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devolutivas" (
    "id" BIGSERIAL NOT NULL,
    "submissao_id" BIGINT NOT NULL,
    "correcao_id" BIGINT,
    "texto_agente" TEXT NOT NULL,
    "texto_final" TEXT NOT NULL,
    "veredito_final" "veredito" NOT NULL,
    "enviada_em" TIMESTAMPTZ(3),
    "enviada_por" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "devolutivas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "submissoes_status_idx" ON "submissoes"("status");

-- CreateIndex
CREATE INDEX "correcoes_submissao_id_idx" ON "correcoes"("submissao_id");

-- CreateIndex
CREATE INDEX "devolutivas_submissao_id_idx" ON "devolutivas"("submissao_id");

-- AddForeignKey
ALTER TABLE "submissoes" ADD CONSTRAINT "submissoes_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissoes" ADD CONSTRAINT "submissoes_anterior_id_fkey" FOREIGN KEY ("anterior_id") REFERENCES "submissoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correcoes" ADD CONSTRAINT "correcoes_submissao_id_fkey" FOREIGN KEY ("submissao_id") REFERENCES "submissoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolutivas" ADD CONSTRAINT "devolutivas_submissao_id_fkey" FOREIGN KEY ("submissao_id") REFERENCES "submissoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolutivas" ADD CONSTRAINT "devolutivas_correcao_id_fkey" FOREIGN KEY ("correcao_id") REFERENCES "correcoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
