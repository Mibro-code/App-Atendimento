-- Painel de Produtividade: visão "Minha produtividade" para Atendente.
-- Aditiva, nasce desligada (Master/Supervisor já têm acesso pelo cargo).
ALTER TABLE "User" ADD COLUMN "canViewOwnProductivity" BOOLEAN NOT NULL DEFAULT false;
