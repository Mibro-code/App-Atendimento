const { TECHNICAL_ASSISTANCE_MESSAGE } = require('./technical-assistance-intake');
function technicalAssistanceGraph() {
  const nodes = [], edges = [];
  const add = (key, type, name, config) => nodes.push({ key, type, name, x: 160, y: 70 + nodes.length * 155, config });
  const edge = (source, sourceHandle, target) => edges.push({ id: `${source}:${sourceHandle}:${target}`, source, sourceHandle, target });
  const known = (key, variable) => add(key, 'condition', 'Informação já registrada?', { rules: [{ left: variable, operator: 'exists', right: '' }] });
  const ask = (key, name, text, variable) => add(key, 'question', name, {
    text, variable, answerType: 'TEXT', maxAttempts: 2, keepWaitingOnAttachments: true,
    invalidMessage: 'Pode informar esse detalhe por escrito? Se preferir continuar com a equipe, escreva atendente.',
  });
  add('start', 'start', 'Entrada da assistência técnica', { trigger: 'NEW_CONVERSATION', channels: ['META'], initialMessage: '' });
  add('tech_intake_documents', 'message', 'Solicitar SN, compra e NF/DANFE', { source: 'TEXT', text: TECHNICAL_ASSISTANCE_MESSAGE });
  known('known_model', 'flow.model');
  ask('technical_model', 'Modelo do relógio', 'Qual é o modelo do seu relógio? Você pode conferir o nome na caixa ou no aplicativo.', 'flow.model');
  add('model_answer_is_problem', 'condition', 'O cliente descreveu o defeito em vez do modelo?', { match: 'ANY', rules: ['parou','carreg','não liga','não funciona','problema','defeito','quebrou'].map(word=>({left:'flow.model',operator:'contains',right:word})) });
  add('keep_problem_from_model', 'variable', 'Guardar o problema sem perguntar novamente', { assignments: [{key:'flow.customerProblem',value:'{{flow.model}}'},{key:'flow.model',value:''}] });
  ask('technical_model_retry', 'Pedir apenas o modelo que falta', 'Já registrei o que aconteceu. Qual é o modelo do seu relógio? Você pode conferir na caixa ou no aplicativo.', 'flow.model');
  known('known_problem', 'flow.customerProblem'); known('known_initial_need', 'flow.initialNeed');
  add('reuse_problem', 'variable', 'Aproveitar o problema informado na triagem', { assignments: [{ key: 'flow.customerProblem', value: '{{flow.initialNeed}}' }] });
  ask('technical_problem', 'Entender o defeito', 'O que deixou de funcionar no relógio? Conte o que acontece e, se houver, qual mensagem aparece na tela.', 'flow.customerProblem');
  ask('technical_attempts', 'Quando começou e o que já foi tentado', 'Há quanto tempo isso começou e o que você já tentou fazer? Se ainda não tentou nada, pode informar isso. Fotos ou vídeos do problema também podem ser anexados para a equipe analisar.', 'flow.technicalAttempts');
  add('human', 'human_handoff', 'Continuar a análise com a assistência', {
    message: 'Obrigado pelas informações! Nossa equipe de assistência técnica vai continuar a análise por aqui. Você pode enviar os documentos, fotos ou vídeos que faltarem nesta conversa.',
    reason: 'Assistência Técnica | Modelo: {{flow.model}} | Problema: {{flow.customerProblem}} | Início e tentativas: {{flow.technicalAttempts}} | Anexos recebidos durante a coleta: {{flow.technicalAttachmentCount}}. SN, local de compra e NF/DANFE solicitados; análise e garantia dependem da equipe.',
  });
  edge('start', 'next', 'tech_intake_documents'); edge('tech_intake_documents', 'next', 'known_model');
  edge('known_model', 'true', 'known_problem'); edge('known_model', 'false', 'technical_model');
  edge('technical_model', 'next', 'model_answer_is_problem'); edge('technical_model', 'invalid', 'human');
  edge('model_answer_is_problem','false','known_problem');edge('model_answer_is_problem','true','keep_problem_from_model');
  edge('keep_problem_from_model','next','technical_model_retry');edge('technical_model_retry','next','known_problem');edge('technical_model_retry','invalid','human');
  edge('known_problem', 'true', 'technical_attempts'); edge('known_problem', 'false', 'known_initial_need');
  edge('known_initial_need', 'true', 'reuse_problem'); edge('known_initial_need', 'false', 'technical_problem');
  edge('reuse_problem', 'next', 'technical_attempts'); edge('technical_problem', 'next', 'technical_attempts');
  edge('technical_problem', 'invalid', 'human'); edge('technical_attempts', 'next', 'human'); edge('technical_attempts', 'invalid', 'human');
  return { nodes, edges, viewport: { x: 0, y: 0, zoom: 0.8 } };
}
module.exports = { technicalAssistanceGraph };
