ALTER TYPE "BotFlowStepAction" ADD VALUE IF NOT EXISTS 'SHOW_OPTIONS';
ALTER TYPE "BotFlowStepAction" ADD VALUE IF NOT EXISTS 'USE_RESPONSE_BLOCK';

CREATE TABLE "BotResponseBlock" (
  "id" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'RESPONSE',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BotResponseBlock_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BotResponseBlock_botId_code_key" ON "BotResponseBlock"("botId", "code");
CREATE INDEX "BotResponseBlock_botId_active_idx" ON "BotResponseBlock"("botId", "active");
ALTER TABLE "BotResponseBlock" ADD CONSTRAINT "BotResponseBlock_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BotSynonymGroup" (
  "id" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "terms" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BotSynonymGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BotSynonymGroup_botId_key_key" ON "BotSynonymGroup"("botId", "key");
CREATE INDEX "BotSynonymGroup_botId_active_idx" ON "BotSynonymGroup"("botId", "active");
ALTER TABLE "BotSynonymGroup" ADD CONSTRAINT "BotSynonymGroup_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BotFlowStep" ADD COLUMN "responseBlockId" TEXT;
CREATE INDEX "BotFlowStep_responseBlockId_idx" ON "BotFlowStep"("responseBlockId");
ALTER TABLE "BotFlowStep" ADD CONSTRAINT "BotFlowStep_responseBlockId_fkey" FOREIGN KEY ("responseBlockId") REFERENCES "BotResponseBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "BotFlowOption" (
  "id" TEXT NOT NULL,
  "stepId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "nextStepId" TEXT,
  "targetIntentId" TEXT,
  "responseBlockId" TEXT,
  "conditions" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BotFlowOption_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BotFlowOption_stepId_value_key" ON "BotFlowOption"("stepId", "value");
CREATE INDEX "BotFlowOption_stepId_order_idx" ON "BotFlowOption"("stepId", "order");
CREATE INDEX "BotFlowOption_targetIntentId_idx" ON "BotFlowOption"("targetIntentId");
CREATE INDEX "BotFlowOption_responseBlockId_idx" ON "BotFlowOption"("responseBlockId");
ALTER TABLE "BotFlowOption" ADD CONSTRAINT "BotFlowOption_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "BotFlowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BotFlowOption" ADD CONSTRAINT "BotFlowOption_responseBlockId_fkey" FOREIGN KEY ("responseBlockId") REFERENCES "BotResponseBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;
