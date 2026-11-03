UPDATE "Bot" SET "featureFlags" = COALESCE("featureFlags", '{}'::jsonb) || '{"guidedFlowEnabled":true,"guidedEntryIntentId":"mibro-guided-main","flowEngineEnabled":true,"externalAiFallbackEnabled":false}'::jsonb WHERE "id" = 'mibro-assistant-observer';

INSERT INTO "BotResponseBlock" ("id","botId","code","name","content","kind","updatedAt") VALUES
('mibro-block-main','mibro-assistant-observer','MAIN_MENU','Menu principal','Para te ajudar de forma rápida, escolha uma opção:','QUESTION',NOW()),
('mibro-block-support','mibro-assistant-observer','SUPPORT_MENU','Menu de suporte','Qual tipo de suporte você precisa?','QUESTION',NOW()),
('mibro-block-model','mibro-assistant-observer','ASK_MODEL','Perguntar modelo','Qual é o modelo do seu produto Mibro?','QUESTION',NOW()),
('mibro-block-app','mibro-assistant-observer','ASK_APP','Perguntar aplicativo','Você usa o aplicativo Mibro Fit? Se usa outro, informe qual.','QUESTION',NOW()),
('mibro-block-os','mibro-assistant-observer','ASK_OS','Perguntar sistema','Seu celular usa Android ou iPhone (iOS)?','QUESTION',NOW()),
('mibro-block-pair','mibro-assistant-observer','PAIR_BY_APP','Parear pelo aplicativo','Abra o Mibro Fit, entre em Dispositivo e escolha Adicionar dispositivo. Faça o pareamento por dentro do aplicativo, não diretamente pelas configurações Bluetooth do celular.','RESPONSE',NOW()),
('mibro-block-bluetooth','mibro-assistant-observer','CHECK_BLUETOOTH','Verificar Bluetooth','Confirme se o Bluetooth está ligado e se o Mibro Fit possui permissão para Bluetooth e dispositivos próximos.','RESPONSE',NOW()),
('mibro-block-charger','mibro-assistant-observer','CHECK_CHARGER','Verificar carregador','Limpe suavemente os contatos, encaixe o carregador corretamente e teste outra fonte USB de 5 V. Aguarde alguns minutos antes de tentar ligar.','RESPONSE',NOW()),
('mibro-block-notifications','mibro-assistant-observer','CHECK_NOTIFICATIONS','Verificar notificações','No Mibro Fit, habilite as notificações do aplicativo desejado e confirme no celular as permissões de notificações e execução em segundo plano.','RESPONSE',NOW()),
('mibro-block-order','mibro-assistant-observer','ASK_ORDER','Perguntar pedido','Informe o número do pedido e o canal onde a compra foi realizada.','QUESTION',NOW()),
('mibro-block-handoff','mibro-assistant-observer','HANDOFF_SUPPORT','Encaminhar ao suporte','Vou encaminhar o caso ao nosso time. As informações que você forneceu serão mantidas para o atendente continuar daqui.','HANDOFF',NOW())
ON CONFLICT ("botId","code") DO NOTHING;

INSERT INTO "BotSynonymGroup" ("id","botId","key","label","terms","updatedAt") VALUES
('mibro-syn-connection','mibro-assistant-observer','CONEXAO','Conexão',ARRAY['conectar','conecta','conexao','parear','pareia','pareamento'],NOW()),
('mibro-syn-app','mibro-assistant-observer','APP','Aplicativo',ARRAY['app','aplicativo','mibro fit','mibrofit'],NOW()),
('mibro-syn-support','mibro-assistant-observer','SUPORTE','Suporte',ARRAY['suporte','ajuda','problema','defeito'],NOW()),
('mibro-syn-notification','mibro-assistant-observer','NOTIFICACOES','Notificações',ARRAY['notificacao','notificacoes','aviso','alerta'],NOW()),
('mibro-syn-battery','mibro-assistant-observer','BATERIA','Bateria',ARRAY['bateria','carga','carregar','carregamento'],NOW()),
('mibro-syn-order','mibro-assistant-observer','PEDIDO','Pedido',ARRAY['pedido','compra','entrega','rastreio'],NOW())
ON CONFLICT ("botId","key") DO NOTHING;

INSERT INTO "BotIntent" ("id","botId","name","description","priority","active","fallbackAction","updatedAt") VALUES
('mibro-guided-main','mibro-assistant-observer','Menu principal','Entrada do atendimento guiado',110,true,'USE_BOT_FALLBACK',NOW()),
('mibro-guided-support','mibro-assistant-observer','Suporte guiado','Menu de problemas técnicos',109,true,'USE_BOT_FALLBACK',NOW()),
('mibro-guided-notifications','mibro-assistant-observer','Notificações','Diagnóstico de notificações',101,true,'TRANSFER_TO_HUMAN',NOW()),
('mibro-guided-gps','mibro-assistant-observer','GPS','Diagnóstico de GPS',100,true,'TRANSFER_TO_HUMAN',NOW()),
('mibro-guided-screen','mibro-assistant-observer','Tela','Diagnóstico de tela',100,true,'TRANSFER_TO_HUMAN',NOW()),
('mibro-guided-other','mibro-assistant-observer','Outro assunto','Encaminhamento seguro',80,true,'TRANSFER_TO_HUMAN',NOW())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "BotIntentExample" ("id","intentId","text") VALUES
('mibro-guided-main-ex1','mibro-guided-main','menu'),('mibro-guided-main-ex2','mibro-guided-main','opcoes'),
('mibro-guided-support-ex1','mibro-guided-support','suporte'),('mibro-guided-support-ex2','mibro-guided-support','preciso de ajuda'),
('mibro-guided-notification-ex1','mibro-guided-notifications','notificacoes'),('mibro-guided-gps-ex1','mibro-guided-gps','gps nao funciona'),
('mibro-guided-screen-ex1','mibro-guided-screen','problema na tela'),('mibro-guided-other-ex1','mibro-guided-other','outro')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "BotFlowStep" ("id","intentId","name","order","action","question","responseBlockId","maxAttempts","updatedAt") VALUES
('mibro-step-main','mibro-guided-main','Opções principais',1,'SHOW_OPTIONS','Para te ajudar de forma rápida, escolha uma opção:','mibro-block-main',3,NOW()),
('mibro-step-support','mibro-guided-support','Opções de suporte',1,'SHOW_OPTIONS','Qual tipo de suporte você precisa?','mibro-block-support',3,NOW()),
('mibro-step-other','mibro-guided-other','Encaminhar outro assunto',1,'HANDOFF_HUMAN',NULL,'mibro-block-handoff',3,NOW()),
('mibro-step-notify-model','mibro-guided-notifications','Identificar modelo',1,'ASK_QUESTION',NULL,'mibro-block-model',3,NOW()),
('mibro-step-notify-os','mibro-guided-notifications','Identificar sistema',2,'ASK_QUESTION',NULL,'mibro-block-os',3,NOW()),
('mibro-step-notify-check','mibro-guided-notifications','Verificar notificações',3,'USE_RESPONSE_BLOCK',NULL,'mibro-block-notifications',3,NOW()),
('mibro-step-notify-handoff','mibro-guided-notifications','Encaminhar suporte',4,'HANDOFF_HUMAN',NULL,'mibro-block-handoff',3,NOW()),
('mibro-step-gps-model','mibro-guided-gps','Identificar modelo',1,'ASK_QUESTION',NULL,'mibro-block-model',3,NOW()),
('mibro-step-gps-handoff','mibro-guided-gps','Encaminhar GPS',2,'HANDOFF_HUMAN',NULL,'mibro-block-handoff',3,NOW()),
('mibro-step-screen-model','mibro-guided-screen','Identificar modelo',1,'ASK_QUESTION',NULL,'mibro-block-model',3,NOW()),
('mibro-step-screen-handoff','mibro-guided-screen','Encaminhar tela',2,'HANDOFF_HUMAN',NULL,'mibro-block-handoff',3,NOW())
ON CONFLICT ("id") DO NOTHING;

UPDATE "BotFlowStep" SET "entityKey"='productName', "nextStepId"='mibro-step-notify-os' WHERE "id"='mibro-step-notify-model';
UPDATE "BotFlowStep" SET "entityKey"='phoneOs', "nextStepId"='mibro-step-notify-check' WHERE "id"='mibro-step-notify-os';
UPDATE "BotFlowStep" SET "nextStepId"='mibro-step-notify-handoff' WHERE "id"='mibro-step-notify-check';
UPDATE "BotFlowStep" SET "entityKey"='productName', "nextStepId"='mibro-step-gps-handoff' WHERE "id"='mibro-step-gps-model';
UPDATE "BotFlowStep" SET "entityKey"='productName', "nextStepId"='mibro-step-screen-handoff' WHERE "id"='mibro-step-screen-model';

INSERT INTO "BotFlowOption" ("id","stepId","label","value","aliases","order","targetIntentId","updatedAt") VALUES
('mibro-opt-product','mibro-step-main','Produto','PRODUTO',ARRAY['produto','modelo','comprar'],1,'mibro-assistant-intent-8',NOW()),
('mibro-opt-support','mibro-step-main','Suporte','SUPORTE',ARRAY['suporte','ajuda','problema'],2,'mibro-guided-support',NOW()),
('mibro-opt-warranty','mibro-step-main','Garantia','GARANTIA',ARRAY['garantia','defeito'],3,'mibro-assistant-intent-5',NOW()),
('mibro-opt-order','mibro-step-main','Pedido','PEDIDO',ARRAY['pedido','entrega','rastreio'],4,'mibro-assistant-intent-6',NOW()),
('mibro-opt-exchange','mibro-step-main','Troca','TROCA',ARRAY['troca','devolucao','reembolso'],5,'mibro-assistant-intent-7',NOW()),
('mibro-opt-other','mibro-step-main','Outro','OUTRO',ARRAY['outro','outros'],6,'mibro-guided-other',NOW()),
('mibro-opt-connection','mibro-step-support','Conexão','CONEXAO',ARRAY['conectar','parear','pareamento'],1,'mibro-assistant-intent-1',NOW()),
('mibro-opt-app','mibro-step-support','Aplicativo','APP',ARRAY['app','aplicativo','mibro fit'],2,'mibro-assistant-intent-2',NOW()),
('mibro-opt-notification','mibro-step-support','Notificações','NOTIFICACOES',ARRAY['notificacao','aviso'],3,'mibro-guided-notifications',NOW()),
('mibro-opt-battery','mibro-step-support','Bateria','BATERIA',ARRAY['bateria','autonomia'],4,'mibro-assistant-intent-3',NOW()),
('mibro-opt-charge','mibro-step-support','Carregamento','CARREGAMENTO',ARRAY['carregar','carga','carregador'],5,'mibro-assistant-intent-3',NOW()),
('mibro-opt-gps','mibro-step-support','GPS','GPS',ARRAY['gps','localizacao'],6,'mibro-guided-gps',NOW()),
('mibro-opt-screen','mibro-step-support','Tela','TELA',ARRAY['tela','display'],7,'mibro-guided-screen',NOW()),
('mibro-opt-support-other','mibro-step-support','Outro','OUTRO',ARRAY['outro','outros'],8,'mibro-guided-other',NOW())
ON CONFLICT ("stepId","value") DO NOTHING;

-- Fluxos mínimos nas intenções antigas: só são inseridos quando ainda não
-- existe nenhuma configuração manual para a intenção.
INSERT INTO "BotFlowStep" ("id","intentId","name","order","action","responseBlockId","entityKey","nextStepId","maxAttempts","updatedAt")
SELECT 'mibro-step-connection-model','mibro-assistant-intent-1','Identificar modelo',1,'ASK_QUESTION','mibro-block-model','productName','mibro-step-connection-app',3,NOW() WHERE NOT EXISTS (SELECT 1 FROM "BotFlowStep" WHERE "intentId"='mibro-assistant-intent-1');
INSERT INTO "BotFlowStep" ("id","intentId","name","order","action","responseBlockId","entityKey","nextStepId","maxAttempts","updatedAt") SELECT 'mibro-step-connection-app','mibro-assistant-intent-1','Identificar aplicativo',2,'ASK_QUESTION','mibro-block-app','appName','mibro-step-connection-pair',3,NOW() WHERE EXISTS (SELECT 1 FROM "BotFlowStep" WHERE "id"='mibro-step-connection-model');
INSERT INTO "BotFlowStep" ("id","intentId","name","order","action","responseBlockId","nextStepId","maxAttempts","updatedAt") SELECT 'mibro-step-connection-pair','mibro-assistant-intent-1','Parear pelo aplicativo',3,'USE_RESPONSE_BLOCK','mibro-block-pair','mibro-step-connection-bluetooth',3,NOW() WHERE EXISTS (SELECT 1 FROM "BotFlowStep" WHERE "id"='mibro-step-connection-model');
INSERT INTO "BotFlowStep" ("id","intentId","name","order","action","responseBlockId","nextStepId","maxAttempts","updatedAt") SELECT 'mibro-step-connection-bluetooth','mibro-assistant-intent-1','Verificar Bluetooth',4,'USE_RESPONSE_BLOCK','mibro-block-bluetooth','mibro-step-connection-handoff',3,NOW() WHERE EXISTS (SELECT 1 FROM "BotFlowStep" WHERE "id"='mibro-step-connection-model');
INSERT INTO "BotFlowStep" ("id","intentId","name","order","action","responseBlockId","maxAttempts","updatedAt") SELECT 'mibro-step-connection-handoff','mibro-assistant-intent-1','Encaminhar se necessário',5,'HANDOFF_HUMAN','mibro-block-handoff',3,NOW() WHERE EXISTS (SELECT 1 FROM "BotFlowStep" WHERE "id"='mibro-step-connection-model');

INSERT INTO "BotFlowStep" ("id","intentId","name","order","action","responseBlockId","entityKey","nextStepId","maxAttempts","updatedAt") SELECT 'mibro-step-app-model','mibro-assistant-intent-2','Identificar modelo',1,'ASK_QUESTION','mibro-block-model','productName','mibro-step-app-os',3,NOW() WHERE NOT EXISTS (SELECT 1 FROM "BotFlowStep" WHERE "intentId"='mibro-assistant-intent-2');
INSERT INTO "BotFlowStep" ("id","intentId","name","order","action","responseBlockId","entityKey","nextStepId","maxAttempts","updatedAt") SELECT 'mibro-step-app-os','mibro-assistant-intent-2','Identificar sistema',2,'ASK_QUESTION','mibro-block-os','phoneOs','mibro-step-app-handoff',3,NOW() WHERE EXISTS (SELECT 1 FROM "BotFlowStep" WHERE "id"='mibro-step-app-model');
INSERT INTO "BotFlowStep" ("id","intentId","name","order","action","responseBlockId","maxAttempts","updatedAt") SELECT 'mibro-step-app-handoff','mibro-assistant-intent-2','Encaminhar aplicativo',3,'HANDOFF_HUMAN','mibro-block-handoff',3,NOW() WHERE EXISTS (SELECT 1 FROM "BotFlowStep" WHERE "id"='mibro-step-app-model');

INSERT INTO "BotFlowStep" ("id","intentId","name","order","action","responseBlockId","entityKey","nextStepId","maxAttempts","updatedAt") SELECT 'mibro-step-charge-model','mibro-assistant-intent-3','Identificar modelo',1,'ASK_QUESTION','mibro-block-model','productName','mibro-step-charge-check',3,NOW() WHERE NOT EXISTS (SELECT 1 FROM "BotFlowStep" WHERE "intentId"='mibro-assistant-intent-3');
INSERT INTO "BotFlowStep" ("id","intentId","name","order","action","responseBlockId","nextStepId","maxAttempts","updatedAt") SELECT 'mibro-step-charge-check','mibro-assistant-intent-3','Verificar carregador',2,'USE_RESPONSE_BLOCK','mibro-block-charger','mibro-step-charge-handoff',3,NOW() WHERE EXISTS (SELECT 1 FROM "BotFlowStep" WHERE "id"='mibro-step-charge-model');
INSERT INTO "BotFlowStep" ("id","intentId","name","order","action","responseBlockId","maxAttempts","updatedAt") SELECT 'mibro-step-charge-handoff','mibro-assistant-intent-3','Encaminhar carregamento',3,'HANDOFF_HUMAN','mibro-block-handoff',3,NOW() WHERE EXISTS (SELECT 1 FROM "BotFlowStep" WHERE "id"='mibro-step-charge-model');

INSERT INTO "BotFlowStep" ("id","intentId","name","order","action","responseBlockId","entityKey","nextStepId","maxAttempts","updatedAt") SELECT 'mibro-step-order-ask','mibro-assistant-intent-6','Identificar pedido',1,'ASK_QUESTION','mibro-block-order','orderContext','mibro-step-order-handoff',3,NOW() WHERE NOT EXISTS (SELECT 1 FROM "BotFlowStep" WHERE "intentId"='mibro-assistant-intent-6');
INSERT INTO "BotFlowStep" ("id","intentId","name","order","action","responseBlockId","maxAttempts","updatedAt") SELECT 'mibro-step-order-handoff','mibro-assistant-intent-6','Encaminhar pedido',2,'HANDOFF_HUMAN','mibro-block-handoff',3,NOW() WHERE EXISTS (SELECT 1 FROM "BotFlowStep" WHERE "id"='mibro-step-order-ask');

INSERT INTO "BotFlowStep" ("id","intentId","name","order","action","responseBlockId","entityKey","nextStepId","maxAttempts","updatedAt") SELECT 'mibro-step-product-model','mibro-assistant-intent-8','Identificar produto',1,'ASK_QUESTION','mibro-block-model','productName','mibro-step-product-knowledge',3,NOW() WHERE NOT EXISTS (SELECT 1 FROM "BotFlowStep" WHERE "intentId"='mibro-assistant-intent-8');
INSERT INTO "BotFlowStep" ("id","intentId","name","order","action","nextStepId","maxAttempts","updatedAt") SELECT 'mibro-step-product-knowledge','mibro-assistant-intent-8','Consultar produtos',2,'USE_KNOWLEDGE','mibro-step-product-handoff',3,NOW() WHERE EXISTS (SELECT 1 FROM "BotFlowStep" WHERE "id"='mibro-step-product-model');
INSERT INTO "BotFlowStep" ("id","intentId","name","order","action","responseBlockId","maxAttempts","updatedAt") SELECT 'mibro-step-product-handoff','mibro-assistant-intent-8','Encaminhar comercial',3,'HANDOFF_HUMAN','mibro-block-handoff',3,NOW() WHERE EXISTS (SELECT 1 FROM "BotFlowStep" WHERE "id"='mibro-step-product-model');

INSERT INTO "BotFlowStep" ("id","intentId","name","order","action","knowledgeSourceId","nextStepId","maxAttempts","updatedAt") SELECT 'mibro-step-warranty-knowledge','mibro-assistant-intent-5','Consultar garantia',1,'USE_KNOWLEDGE','mibro-garantia','mibro-step-warranty-handoff',3,NOW() WHERE NOT EXISTS (SELECT 1 FROM "BotFlowStep" WHERE "intentId"='mibro-assistant-intent-5');
INSERT INTO "BotFlowStep" ("id","intentId","name","order","action","responseBlockId","maxAttempts","updatedAt") SELECT 'mibro-step-warranty-handoff','mibro-assistant-intent-5','Encaminhar garantia',2,'HANDOFF_HUMAN','mibro-block-handoff',3,NOW() WHERE EXISTS (SELECT 1 FROM "BotFlowStep" WHERE "id"='mibro-step-warranty-knowledge');

INSERT INTO "BotFlowStep" ("id","intentId","name","order","action","knowledgeSourceId","nextStepId","maxAttempts","updatedAt") SELECT 'mibro-step-exchange-knowledge','mibro-assistant-intent-7','Consultar política de troca',1,'USE_KNOWLEDGE','mibro-trocas','mibro-step-exchange-handoff',3,NOW() WHERE NOT EXISTS (SELECT 1 FROM "BotFlowStep" WHERE "intentId"='mibro-assistant-intent-7');
INSERT INTO "BotFlowStep" ("id","intentId","name","order","action","responseBlockId","maxAttempts","updatedAt") SELECT 'mibro-step-exchange-handoff','mibro-assistant-intent-7','Encaminhar troca',2,'HANDOFF_HUMAN','mibro-block-handoff',3,NOW() WHERE EXISTS (SELECT 1 FROM "BotFlowStep" WHERE "id"='mibro-step-exchange-knowledge');
