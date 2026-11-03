// Draft-only blueprint. Does not read a database, change a bot or publish flows.
// All routing and collection rules are represented by existing editor nodes.

const TOPICS = [
  { id: 'warranty', label: 'Garantia', words: ['garantia'], key: 'ASSIST_MIBRO_GARANTIA', target: 'faq' },
  { id: 'returns', label: 'Trocas e devoluções', words: ['devolver', 'devolução', 'arrependimento', 'trocar o produto', 'trocar meu relógio', 'troca do pedido'], key: 'ASSIST_MIBRO_TROCAS', target: 'faq' },
  { id: 'orders', label: 'Pedido e rastreamento', words: ['meu pedido', 'rastre', 'não chegou', 'minha entrega', 'status do pedido'], target: 'orders' },
  { id: 'payment', label: 'Pagamento e frete', words: ['pagamento', 'pagar', 'pix', 'boleto', 'frete', 'prazo de entrega'], key: 'ASSIST_MIBRO_PAGAMENTO', target: 'faq' },
  { id: 'resale', label: 'Atacado e revenda', words: ['atacado', 'revenda', 'distribuidor'], target: 'resale' },
  { id: 'company', label: 'Sobre a Mibro', words: ['oficial', 'original', 'sobre a mibro', 'empresa'], key: 'ASSIST_MIBRO_EMPRESA', target: 'faq' },
  { id: 'support', label: 'Suporte e aplicativo', words: ['problema', 'defeito', 'não funciona', 'carreg', 'notifica', 'parea', 'conect', 'bluetooth', 'mibro fit', 'aplicativo', 'pulseira', 'mostrador'], key: 'ASSIST_MIBRO_SUPORTE', target: 'support' },
  { id: 'products', label: 'Produtos e modelos', words: ['modelo', 'produto', 'relógio', 'smartwatch', 'gps', 'bateria', 'comprar', 'preço'], target: 'products' },
];

function graphBuilder() {
  const graph = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 0.8 } };
  return {
    graph,
    node(key, type, name, config = {}) {
      // Vertical layout avoids the long crossing lines of the old single graph.
      graph.nodes.push({ key, type, name, x: 120 + (graph.nodes.length % 2) * 340, y: 80 + Math.floor(graph.nodes.length / 2) * 190, config });
    },
    edge(source, sourceHandle, target) { graph.edges.push({ id: `${source}:${sourceHandle}:${target}`, source, sourceHandle, target }); },
  };
}

function buildAssistantDraftBundle({ products = [], availableKeys = new Set(), flowIds = {} } = {}) {
  const definitions = [
    ['main', 'Assistente • Entrada'], ['router', 'Assistente • Assunto'],
    ['technical', 'Assistente • Assistência Técnica'], ['support', 'Assistente • Suporte'],
    ['orders', 'Assistente • Pedido'], ['resale', 'Assistente • Revenda'],
    ['products', 'Assistente • Produtos'], ['faq', 'Assistente • Orientações'],
    ['closure', 'Assistente • Continuação'],
  ];
  const ids = Object.fromEntries(definitions.map(([key]) => [key, flowIds[key] || `draft_assistant_${key}`]));
  if (new Set(Object.values(ids)).size !== definitions.length) throw Error('Cada fluxo precisa de um identificador próprio.');
  const flows = [];
  const begin = key => {
    const b = graphBuilder();
    b.node('start', 'start', key === 'main' ? 'Após a triagem' : 'Entrada do assunto', { trigger: key === 'main' ? 'AFTER_TRIAGE' : 'NEW_CONVERSATION', channels: ['META'], initialMessage: '' });
    flows.push({ key, id: ids[key], name: definitions.find(([id]) => id === key)[1], status: 'DRAFT', isDefault: false, intendedDefault: key === 'main', graph: b.graph });
    return b;
  };
  const go = (b, key, target) => b.node(key, 'goto_flow', definitions.find(([id]) => id === target)[1], { flowId: ids[target] });
  const condition = (b, key, name, left, operator, right) => b.node(key, 'condition', name, { rules: [{ left, operator, right }] });
  const handoff = (b, key = 'human', message = '') => b.node(key, 'human_handoff', 'Continuar com a equipe do setor', {
    message, reason: 'Solicitação: {{flow.customerProblem}} | Modelo/app: {{flow.model}} | Pedido: {{flow.orderNumber}} | Revenda: {{flow.resaleNeed}}',
  });
  const askUnlessKnown = (b, { field, question, name }) => {
    condition(b, 'known', 'Informação já preenchida?', field, 'exists', '');
    b.node('ask', 'question', name, { text: question, variable: field, answerType: 'TEXT', maxAttempts: 2 });
    b.edge('known', 'false', 'ask'); b.edge('known', 'true', 'human'); b.edge('ask', 'next', 'human'); b.edge('ask', 'invalid', 'human');
  };

  let b = begin('main');
  condition(b, 'wholesale', 'Comercial Atacado: somente equipe', 'conversation.categoryCode', '==', 'ATACADO');
  condition(b, 'tech_intake_category', 'Assistência Técnica?', 'conversation.categoryCode', '==', '1_ASSISTENCIA_TECNICA');
  go(b, 'to_technical', 'technical');
  condition(b, 'known_need', 'Triagem já registrou a solicitação?', 'flow.initialNeed', 'exists', '');
  b.node('reuse_need', 'variable', 'Aproveitar o que o cliente informou', { assignments: [{ key: 'flow.customerProblem', value: '{{flow.initialNeed}}' }] });
  b.node('problem', 'question', 'Entender a solicitação uma vez', { text: 'Como podemos ajudar neste setor? Conte sua dúvida ou solicitação.', variable: 'flow.customerProblem', answerType: 'TEXT', maxAttempts: 2 });
  go(b, 'to_router', 'router');
  handoff(b);
  b.edge('start', 'next', 'wholesale'); b.edge('wholesale', 'true', 'human'); b.edge('wholesale', 'false', 'tech_intake_category');
  b.edge('tech_intake_category', 'true', 'to_technical'); b.edge('tech_intake_category', 'false', 'known_need');
  b.edge('known_need', 'true', 'reuse_need'); b.edge('known_need', 'false', 'problem');
  b.edge('reuse_need', 'next', 'to_router'); b.edge('problem', 'next', 'to_router'); b.edge('problem', 'invalid', 'human');

  b = begin('router');
  b.edge('start', 'next', `topic_${TOPICS[0].id}`);
  b.node('topics', 'menu', 'Escolher só quando necessário', { text: 'Qual assunto você deseja tratar?', display: 'LIST', variable: 'flow.topic', maxAttempts: 2, options: [...TOPICS.map(t => ({ id: t.id, label: t.label })), { id: 'human', label: 'Falar com atendente' }] });
  handoff(b); b.edge('topics', 'opt:human', 'human'); b.edge('topics', 'invalid', 'human');
  for (const [index, topic] of TOPICS.entries()) {
    b.node(`choose_${topic.id}`, 'variable', topic.label, { assignments: [{ key: 'flow.topic', value: topic.id }] });
    // The editor accepts ten rules per condition; never silently drop aliases.
    for (let offset = 0; offset < topic.words.length; offset += 10) {
      const key = offset ? `topic_${topic.id}_${offset}` : `topic_${topic.id}`;
      b.node(key, 'condition', `Assunto: ${topic.label}`, { match: 'ANY', rules: topic.words.slice(offset, offset + 10).map(word => ({ left: 'flow.customerProblem', operator: 'contains', right: word })) });
      b.edge(key, 'true', `choose_${topic.id}`);
      b.edge(key, 'false', offset + 10 < topic.words.length ? `topic_${topic.id}_${offset + 10}` : TOPICS[index + 1] ? `topic_${TOPICS[index + 1].id}` : 'topics');
    }
    b.edge('topics', `opt:${topic.id}`, `choose_${topic.id}`);
    b.edge(`choose_${topic.id}`, 'next', `to_${topic.target}`);
  }
  for (const target of [...new Set(TOPICS.map(t => t.target))]) go(b, `to_${target}`, target);

  b = begin('technical');
  flows[flows.length - 1].graph = require('./technical-assistance-sequence').technicalAssistanceGraph();

  b = begin('support');
  if (availableKeys.has('ASSIST_MIBRO_SUPORTE')) {
    b.node('answer', 'message', 'Orientação de suporte cadastrada', { source: 'LIBRARY', responseKey: 'ASSIST_MIBRO_SUPORTE' });
    b.edge('start', 'next', 'answer'); b.edge('answer', 'next', 'known');
  } else b.edge('start', 'next', 'known');
  askUnlessKnown(b, { field: 'flow.model', name: 'Modelo e aplicativo', question: 'Qual é o modelo do relógio e qual aplicativo você utiliza?' }); handoff(b);

  b = begin('orders');
  b.edge('start', 'next', 'known');
  askUnlessKnown(b, { field: 'flow.orderNumber', name: 'Número do pedido', question: 'Informe o número do pedido para a equipe consultar. Não consigo confirmar rastreio ou status em tempo real.' }); handoff(b);

  b = begin('resale');
  b.edge('start', 'next', 'known');
  askUnlessKnown(b, { field: 'flow.resaleNeed', name: 'Produto e quantidade', question: 'Qual produto e quantidade você procura? Nossa equipe confirmará as condições comerciais.' }); handoff(b);

  b = begin('faq');
  const faqs = TOPICS.filter(t => t.target === 'faq');
  b.edge('start', 'next', `check_${faqs[0].id}`);
  go(b, 'to_closure', 'closure'); handoff(b);
  for (const [index, topic] of faqs.entries()) {
    condition(b, `check_${topic.id}`, topic.label, 'flow.topic', '==', topic.id);
    b.edge(`check_${topic.id}`, 'false', faqs[index + 1] ? `check_${faqs[index + 1].id}` : 'human');
    if (availableKeys.has(topic.key)) {
      b.node(`answer_${topic.id}`, 'message', 'Resposta cadastrada: ' + topic.label, { source: 'LIBRARY', responseKey: topic.key });
      b.edge(`check_${topic.id}`, 'true', `answer_${topic.id}`); b.edge(`answer_${topic.id}`, 'next', 'to_closure');
    } else b.edge(`check_${topic.id}`, 'true', 'human');
  }
  // With no eligible library answer, the continuation jump is deliberately absent.
  if (!faqs.some(t => availableKeys.has(t.key))) b.graph.nodes = b.graph.nodes.filter(n => n.key !== 'to_closure');

  b = begin('products');
  const catalog = products.filter(p => p?.key && p?.product && availableKeys.has(p.key)).slice(0, 40);
  handoff(b);
  if (!catalog.length) b.edge('start', 'next', 'human');
  else {
    b.node('models', 'menu', 'Selecionar modelo sem adivinhar', { text: 'Selecione o modelo para consultar a ficha cadastrada.', display: 'LIST', variable: 'flow.model', maxAttempts: 2, options: [...catalog.map((p, i) => ({ id: `model_${i}`, label: p.title || p.product })), { id: 'human', label: 'Falar com atendente' }] });
    b.edge('models', 'opt:human', 'human'); b.edge('models', 'invalid', 'human'); go(b, 'to_closure', 'closure');
    b.edge('start', 'next', 'model_0');
    catalog.forEach((p, i) => {
      const aliases = [...new Set([p.product, p.title, `Mibro ${p.product}`, p.product.replace(/\s/g, '')].filter(Boolean))];
      b.node(`model_${i}`, 'condition', 'Modelo já informado: ' + p.product, { match: 'ANY', rules: aliases.map(value => ({ left: 'flow.model', operator: '==', right: value })) });
      b.node(`answer_${i}`, 'message', p.title || p.product, { source: 'LIBRARY', responseKey: p.key });
      b.edge(`model_${i}`, 'true', `answer_${i}`); b.edge(`model_${i}`, 'false', catalog[i + 1] ? `model_${i + 1}` : 'models');
      b.edge('models', `opt:model_${i}`, `answer_${i}`); b.edge(`answer_${i}`, 'next', 'to_closure');
    });
  }

  b = begin('closure');
  b.node('next', 'menu', 'Como deseja continuar?', { text: 'Deseja continuar com a equipe, consultar outro assunto ou encerrar?', display: 'LIST', variable: 'flow.nextAction', maxAttempts: 2, options: [{ id: 'human', label: 'Falar com atendente' }, { id: 'another', label: 'Outro assunto' }, { id: 'done', label: 'Encerrar' }] });
  handoff(b); go(b, 'to_router', 'router');
  b.node('done', 'end', 'Encerrar somente por escolha do cliente', { message: 'Tudo certo! Se precisar de algo mais, é só nos chamar.', finalizeConversation: true });
  // Clear old routing before showing another subject; do not classify the old need again.
  b.node('clear_topic', 'variable', 'Escolher um novo assunto', { assignments: [{ key: 'flow.customerProblem', value: '' }] });
  b.edge('start', 'next', 'next'); b.edge('next', 'opt:human', 'human'); b.edge('next', 'invalid', 'human');
  b.edge('next', 'opt:done', 'done'); b.edge('next', 'opt:another', 'clear_topic'); b.edge('clear_topic', 'next', 'to_router');
  return { revision: 'assistant-draft-20261027', botId: 'mibro-assistant-observer', draftOnly: true, activatesBot: false, publishesVersions: false,
    activationPrerequisites: ['Resolve real flow IDs in a transaction', 'Integrate the shared calendar and outside-hours policy', 'Validate all references and simulations', 'Explicitly approve publication and bot activation'], flows };
}

module.exports = { buildAssistantDraftBundle, TOPICS };
