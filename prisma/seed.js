const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const categories = [
  ["ATENDIMENTO", "Atendimento", "#0f766e"],
  ["SUPORTE", "Suporte", "#2563eb"],
  ["COMERCIAL", "Comercial", "#059669"],
  ["PARCERIAS", "Parcerias", "#7c3aed"],
  ["ATACADO", "Atacado", "#7c3aed"],
  ["GARANTIA", "Garantia", "#dc2626"], ["PEDIDOS", "Pedidos", "#d97706"],
  ["TROCAS_DEVOLUCOES", "Trocas e devoluções", "#db2777"], ["OUTROS", "Outros", "#6b7280"],
];
// Bot de Triagem Inicial (item "Integrar o Bot de Triagem ao sistema de
// Bots"): mesmos valores da migration prisma/migrations/20260902170000_bot_system_triage.
// Duplicado aqui porque `npm test` roda via `prisma db push` (não aplica
// migrations, só sincroniza o schema) — sem isso, o schema de teste teria as
// colunas/tabelas novas mas nenhum Bot SYSTEM_TRIAGE, e handleIncomingTriage
// ficaria em "estado seguro" (sem bot) em vez de testar o fluxo real.
const triageBotId = "system-triage-bot";
const triageSchedules = [
  [0, false], [1, true], [2, true], [3, true], [4, true], [5, true], [6, false],
].map(([dayOfWeek, enabled]) => ({ dayOfWeek, enabled, startTime: "08:00", endTime: "17:00" }));
const triageOptions = [
  ["ATENDIMENTO", "Atendimento", 10],
  ["SUPORTE", "Suporte", 20],
  ["COMERCIAL", "Comercial", 30],
  ["PARCERIAS", "Parcerias", 40],
];

async function seedTriageBot(client = prisma) {
  const bot = await client.bot.upsert({
    where: { id: triageBotId },
    update: {},
    create: {
      id: triageBotId,
      name: "Triagem Inicial",
      description: "Bot do sistema: recebe a primeira mensagem do cliente, mostra o menu de setores e encaminha a conversa. Migrado do fluxo hardcoded para configuração.",
      status: "ACTIVE",
      type: "SYSTEM_TRIAGE",
      isSystem: true,
      channel: "META",
      initialMessage: "👋 {{saudacao}}! Seja bem-vindo(a) à Mibro Brasil!\n\nÉ um prazer receber você por aqui. Nosso atendimento funciona de {{horario}}.\n\nPara encaminharmos você à equipe certa, escolha abaixo o setor com o qual deseja falar.",
      outsideHoursMessage: "🌙 {{saudacao}}! Agradecemos por entrar em contato com a Mibro Brasil.\n\nNo momento, nossa equipe não está online. Nosso atendimento funciona de {{horario}}.\n\nPor favor, envie uma nova mensagem dentro desse horário e teremos prazer em atender você. Até breve!",
      holidayMessage: "🎉 {{saudacao}}! Hoje não teremos atendimento por conta do feriado. Retornaremos no próximo período de atendimento.",
      fallbackMessage: "Desculpe, tivemos um problema para continuar automaticamente. Já avisamos nossa equipe e alguém vai falar com você em instantes.",
      handoffMessage: "✅ Perfeito{{saudacao_virgula}}! Encaminhamos seu atendimento para o setor {{categoria}}. Em breve, nossa equipe continuará a conversa por aqui.",
      timezone: "America/Sao_Paulo",
      runOnNewConversation: true,
      runAfterReopen: true,
      autoReplyEnabled: true,
    },
  });

  for (const schedule of triageSchedules) {
    await client.botSchedule.upsert({
      where: { botId_dayOfWeek: { botId: bot.id, dayOfWeek: schedule.dayOfWeek } },
      update: {}, create: { ...schedule, botId: bot.id },
    });
  }

  for (const [code, label, order] of triageOptions) {
    const category = await client.category.findUnique({ where: { code } });
    if (!category) continue;
    await client.botTriageOption.upsert({
      where: { botId_categoryId: { botId: bot.id, categoryId: category.id } },
      update: {}, create: { botId: bot.id, categoryId: category.id, label, order, enabled: true },
    });
  }
  return bot;
}


const mibroAssistantBotId = "mibro-assistant-observer";
const productKnowledgeDetails = {"mibro-c4":"Tela TFT 2,01 pol. 240x296; chamadas Bluetooth, controle e reprodução de música; mais de 100 modos; 2 ATM; Bluetooth 5.3; autonomia publicada de até 10 dias no uso diário e 45 no básico.","mibro-lite-3":"Tela AMOLED 1,3 pol. 360x360 com AOD; GPS/BeiDou/GLONASS/Galileo/QZSS; chamadas e reprodução de música; mais de 100 modos; 2 ATM; Bluetooth 5.3; até 12 dias no uso diário.","mibro-lite-3-pro":"Tela AMOLED 1,32 pol.; GNSS com GPS/BeiDou/GLONASS/Galileo/QZSS; NFC e chamadas Bluetooth; mais de 150 modos; 5 ATM; até 15 dias no uso diário e 15 horas em GPS.","mibro-gs-pro-2":"Mais de 150 modalidades e triatlo; rotas GPX/KML/TCX; GNSS de dupla frequência GPS L1+L5; chamadas Bluetooth; Mibro OS 2.0; 5 ATM; até 20 dias de uso diário e 20 horas de GPS.","mibro-gs-pro":"Tela AMOLED 1,43 pol.; GPS/BeiDou/GLONASS/Galileo/QZSS; NFC e chamadas Bluetooth; 105 modos; 5 ATM; até 20 dias de uso diário, 17 horas de GPS e 11 horas de chamadas.","mibro-gs-active":"Tela AMOLED de 1000 nits; GPS/BeiDou/GLONASS/Galileo/QZSS; 150 modos; 5 ATM; até 20 dias no modo diário, 50 no básico e 15 horas no GPS.","mibro-gs-active2":"Tela AMOLED 466x466 de 1200 nits; GPS de dupla frequência L1+L5; chamadas Bluetooth; mais de 150 modos; 5 ATM; até 20 dias de uso diário e 15 horas de GPS; sincronização com Strava, Apple Health e Google Fit."};
const officialKnowledge = [
["garantia","Garantia","WARRANTY","https://mibrobrasil.com.br/pages/termos-de-garantia","Nunca aprovar cobertura, troca ou reembolso. Casos de defeito dependem de análise humana; coletar pedido, descrição e evidências e encaminhar ao Suporte."],
["catalogo","Catálogo","PRODUCT","https://mibrobrasil.com.br/collections/todos-os-produtos","Preço, promoção e estoque são dinâmicos. Consultar a página atual ou orientar o cliente a conferir a loja oficial; nunca memorizar como verdade."],
["app","Mibro Fit","MANUAL","https://mibrobrasil.com.br/pages/app-mibro","Pareamento principal pelo Mibro Fit. Requisitos publicados: Android 5.0+ com Bluetooth 4.0; iOS 13.0+."],
["trocas","Trocas e devoluções","POLICY","https://mibrobrasil.com.br/policies/refund-policy","Direito de arrependimento em até 7 dias corridos após o recebimento, conforme condições e solicitação prévia. Explicar, nunca autorizar; encaminhar ao Atendimento/Pós-venda."],
["entrega","Entrega","POLICY","https://mibrobrasil.com.br/policies/shipping-policy","Situação específica exige ferramenta oficial atualizada; sem ferramenta, encaminhar ao Atendimento e nunca fingir consulta."],
["privacidade","Privacidade","POLICY","https://mibrobrasil.com.br/policies/privacy-policy","Política oficial de privacidade."],
["termos","Termos","POLICY","https://mibrobrasil.com.br/policies/terms-of-service","Compatibilidade e funções variam por modelo, sistema e versão. Confirmar na fonte oficial."],
["sobre","Sobre a Mibro","GENERAL","https://mibrobrasil.com.br/pages/sobre-nos","Página institucional oficial."],
["contato","Contato","GENERAL","https://mibrobrasil.com.br/policies/contact-information","Canais oficiais de contato."],
["legal","Aviso legal","POLICY","https://mibrobrasil.com.br/policies/legal-notice","Aviso legal oficial."],
...["mibro-c4","mibro-a3","mibro-lite-3","mibro-lite-3-pro","mibro-gs-pro-2","mibro-gs-pro","mibro-gs-active","mibro-gs-active2"].map(s=>["produto-"+s,s,"PRODUCT","https://mibrobrasil.com.br/products/"+s,productKnowledgeDetails[s] || "Fonte oficial do modelo. Confirmar aqui GPS/GNSS, NFC, chamadas, música, água, sensores, bateria, tela, AOD, bússola e compatibilidade antes de responder."])
];
const assistantIntents = [
["Conexão e pareamento","SUPORTE",["relogio n conecta","app n acha","n pareia","bluetooh nao pega","fica procurando e nada"]],
["Aplicativo e notificações","SUPORTE",["nao chega notificacao","mibro fit nao sincroniza","app nao atualiza"]],
["Carregamento e bateria","SUPORTE",["relogio nao carrega","bateria acaba rapido","nao liga depois de carregar"]],
["Funções e especificações","SUPORTE",["ele tem gps","pode nadar","tem nfc","faz ligacao"]],
["Garantia e defeito","SUPORTE",["quero acionar garantia","tela quebrou","entrou agua","precisa de assistencia"]],
["Pedidos e entrega","ATENDIMENTO",["onde esta meu pedido","pedido atrasado","preciso da nota fiscal"]],
["Troca e devolução","ATENDIMENTO",["quero devolver","quero trocar","pedido reembolso"]],
["Escolha de produto","COMERCIAL",["qual mibro comprar","qual modelo e melhor","tem em estoque","quanto custa"]],
["Parceria e revenda","PARCERIAS",["quero ser revendedor","comprar atacado","sou influenciador"]]
];
async function seedMibroAssistant(client = prisma) {
 const bot=await client.bot.upsert({where:{id:mibroAssistantBotId},update:{},create:{id:mibroAssistantBotId,name:"Assistente Mibro Brasil",description:"Primeiro atendimento pós-triagem. Em observação: analisa e sugere, sem enviar mensagens.",status:"ACTIVE",type:"STANDARD",isSystem:false,channel:"META",initialMessage:"Entendi. Consigo te ajudar com isso.",outsideHoursMessage:"Recebi sua mensagem. Vou registrar as informações para nossa equipe continuar no próximo período.",fallbackMessage:"Não encontrei informação oficial suficiente. Para não passar algo incorreto, vou encaminhar sua dúvida.",runOnNewConversation:false,runAfterReopen:true,autoReplyEnabled:false,toolsEnabled:false,ratingEnabled:false,featureFlags:{interpretationEnabled:true,conversationalBehaviorEnabled:true,contextEnabled:true,observationEnabled:true,learningEnabled:true,agentSuggestionsEnabled:true,knowledgeSuggestionsEnabled:true,knowledgeBaseEnabled:true,handoffAutoPauseEnabled:true,autoFinalizeOnResolution:false,externalAiFallbackEnabled:false,agentPlannerEnabled:true}}});
 await client.botPersonality.upsert({where:{botId:bot.id},update:{},create:{botId:bot.id,preset:"PERSONALIZADO",assistantName:"Assistente Mibro Brasil",roleDescription:"Assistente oficial de primeiro atendimento pós-triagem. Resolve dúvidas simples e intermediárias e encaminha quando um humano é necessário.",tone:["humano","educado","natural","moderno","tecnológico","confiável"],responseStyle:["objetivo","prestativo","passo a passo","conciso"],mandatoryBehaviors:["Interpretar erros, abreviações e contexto","Perguntar só o necessário","Consultar Knowledge oficial","Dar uma orientação por vez","Confirmar o resultado","Resumir fatos e tentativas no handoff"],forbiddenBehaviors:["Inventar especificações, preço ou estoque","Repetir perguntas e procedimentos","Aprovar garantia, troca ou reembolso","Dar diagnóstico médico","Orientar reparo interno"],responseLength:"SHORT",additionalInstructions:"Interprete significado, erros, abreviações, respostas curtas e contexto anterior. Mantenha modelo, app, celular/SO, problema, sintomas, objetivo, informações fornecidas, tentativas, falhas, resultado, pedido, canal de compra e assunto; nunca repita pergunta ou procedimento já respondido. Hierarquia: ferramenta oficial ao vivo > Knowledge oficial > contexto confirmado > regras do Bot > conhecimento geral. Confirme o modelo antes de afirmar GPS/GNSS, NFC, chamadas, música, água, sensores, bateria, tela, AOD, bússola ou compatibilidade. Preço, promoção, estoque e prazo promocional só ao vivo; sem acesso, indique a loja oficial. No Mibro Fit, diagnostique passo a passo e dê uma orientação por vez: energia/carga, Bluetooth, permissões, pareamento pelo app, vínculo anterior e reinício quando apropriado; chamadas podem exigir áudio adicional, sem confundir com pareamento principal. Problema físico, defeito, água, superaquecimento, falha persistente, reparo ou garantia: explique brevemente, não desmonte nem prometa cobertura e encaminhe ao Suporte. Pedido, pagamento, entrega, troca, devolução e nota fiscal: use ferramenta oficial se disponível ou Atendimento; nunca finja consulta nem autorize resultado. Compra/comparação: entenda a necessidade e use apenas especificações confirmadas. Revenda/parceria: Parcerias. Bem-estar não é diagnóstico médico. Primeiro ajude e depois ofereça link oficial. Faça perguntas apenas quando necessárias. Após orientação relevante, confirme se funcionou; positivo resolve, negativo atualiza o caso. No handoff, preserve setor, motivo, produto, problema, informações, procedimentos, resultado e pendência."}});
 for(const [key,title,type,source,content] of officialKnowledge) await client.knowledgeSource.upsert({where:{id:"mibro-"+key},update:{source,content,active:true},create:{id:"mibro-"+key,botId:bot.id,title,type,source,content,tags:["mibro","oficial"]}});
 for(let n=0;n<assistantIntents.length;n++){const [name,code,examples]=assistantIntents[n];const category=await client.category.findUnique({where:{code}});const id="mibro-assistant-intent-"+(n+1);await client.botIntent.upsert({where:{id},update:{},create:{id,botId:bot.id,name,description:name,priority:100-n,active:true,fallbackAction:"TRANSFER_TO_CATEGORY",categoryId:category?.id||null}});for(let i=0;i<examples.length;i++)await client.botIntentExample.upsert({where:{id:id+"-example-"+(i+1)},update:{text:examples[i]},create:{id:id+"-example-"+(i+1),intentId:id,text:examples[i]}});}
 return bot;
}

async function main() {
  for (const [index, [code, name, color]] of categories.entries()) {
    const data = { code, name, color, displayOrder: (index + 1) * 10 };
    await prisma.category.upsert({ where: { code }, update: data, create: data });
  }
  await seedTriageBot();
}
module.exports = { main, seedTriageBot, seedMibroAssistant };

// Só roda sozinho quando chamado como script (`node prisma/seed.js` /
// `npm run db:seed` / `db:seed` do run-tests.js) — quando importado por um
// teste (ex.: test/triage-bot.test.js recriando o Bot de sistema depois de
// um `bot.deleteMany()` sem filtro de outro arquivo de teste), só expõe as
// funções, sem abrir uma segunda conexão nem desconectar o Prisma do módulo
// de quem importou.
if (require.main === module) {
  main().then(() => console.log("Categorias iniciais cadastradas."))
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
