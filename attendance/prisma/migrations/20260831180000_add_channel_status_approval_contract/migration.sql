-- Adiciona dois novos status honestos de conta de canal (item 14/9/10/12 do
-- plano omnichannel): NEEDS_APPROVAL (API existe mas o escopo ainda não foi
-- aprovado pela plataforma, ex.: TikTok Shop Customer Service) e
-- NEEDS_CONTRACT (exige contrato comercial que ainda não existe, ex.:
-- Reclame Aqui). Alteração puramente aditiva em um enum Postgres — não
-- remove nem renomeia nenhum valor existente, não afeta linhas já gravadas.
ALTER TYPE "ChannelAccountStatus" ADD VALUE IF NOT EXISTS 'NEEDS_APPROVAL';
ALTER TYPE "ChannelAccountStatus" ADD VALUE IF NOT EXISTS 'NEEDS_CONTRACT';
