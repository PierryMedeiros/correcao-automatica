-- Similaridade trigram, usada pelo gatilho do §10.24: devolutiva quase idêntica à de outro aluno na
-- mesma skill força revisão humana (limiar inicial em `config.gatilho_similaridade_limiar`).
--
-- A extensão entra agora porque instalar extensão é mudança de banco e mudança de banco é migration
-- (regra dura 4). O índice GIN sobre as devolutivas **não** entra: ele depende da forma da query,
-- que só existe na F7 — índice criado antes da consulta é palpite, não otimização.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
