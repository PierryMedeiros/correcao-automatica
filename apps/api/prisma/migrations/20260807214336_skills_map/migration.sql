-- CreateEnum
CREATE TYPE "modo_avaliacao" AS ENUM ('execucao', 'estatica');

-- CreateTable
CREATE TABLE "skills_map" (
    "id" BIGSERIAL NOT NULL,
    "projeto" TEXT NOT NULL,
    "fase" TEXT NOT NULL,
    "skill_slug" TEXT NOT NULL,
    "modo_avaliacao" "modo_avaliacao" NOT NULL,
    "base_repo_url" TEXT,
    "timeout_s" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "skills_map_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "skills_map_projeto_fase_key" ON "skills_map"("projeto", "fase");
