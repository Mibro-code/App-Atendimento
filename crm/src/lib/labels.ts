export const STATUS_LABELS: Record<string, string> = {
  NOVO: "Novo",
  CONTATO_REALIZADO: "Contato realizado",
  EM_NEGOCIACAO: "Em negociação",
  COTACAO_ENVIADA: "Cotação enviada",
  AGUARDANDO_RETORNO: "Aguardando retorno",
  AGUARDANDO_PAGAMENTO: "Aguardando pagamento",
  CLIENTE_ATIVO: "Cliente ativo",
  SEM_INTERESSE: "Sem interesse",
  VENDA_PERDIDA: "Venda perdida",
  INATIVO: "Inativo",
};

export const TEMPERATURE_LABELS: Record<string, string> = {
  QUENTE: "Quente",
  MORNO: "Morno",
  FRIO: "Frio",
  SEM_CLASSIFICACAO: "Sem classificação",
};

export const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  TELEFONE: "Telefone",
  EMAIL: "E-mail",
  VISITA: "Visita",
  REUNIAO: "Reunião",
  ANOTACAO: "Anotação",
  COTACAO: "Cotação",
  PEDIDO: "Pedido",
  PAGAMENTO: "Pagamento",
  VENDA: "Venda",
  CANCELAMENTO: "Cancelamento",
  FOLLOW_UP: "Follow-up de recompra",
};

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrador",
  SUPERVISOR: "Supervisor",
  VENDEDOR: "Vendedor",
  REPRESENTANTE: "Representante",
};

export const SALE_STAGE_LABELS: Record<string, string> = {
  COTACAO: "Cotação",
  PEDIDO_CRIADO: "Pedido criado",
  AGUARDANDO_APROVACAO: "Aguardando aprovação",
  AGUARDANDO_PAGAMENTO: "Aguardando pagamento",
  PAGAMENTO_CONFIRMADO: "Pagamento confirmado",
  EM_PREPARACAO: "Em preparação",
  ENVIADO: "Enviado",
  ENTREGUE: "Entregue",
  CANCELADO: "Cancelado",
  DIVERGENCIA_OLIST: "Divergência de valores no Olist",
};

export const QUOTE_STATUS_LABELS: Record<string, string> = {
  ABERTA: "Rascunho",
  CALCULADA: "Calculada",
  ENVIADA: "Enviada ao cliente",
  ENVIADA_PARA_ANALISE: "Aguardando aprovação (Olist)",
  CONVERTIDA: "Convertida em cotação real",
  CANCELADA: "Cancelada",
  EXPIRADA: "Expirada",
};

export const PROPOSAL_MODE_LABELS: Record<string, string> = {
  SIMULATION: "Simulação",
  REAL: "Cotação real",
};

export const COMMERCIAL_BRAND_LABELS: Record<string, string> = {
  MIBRO: "Mibro",
  SINCROFIT: "Sincrofit",
};

export const OCCURRENCE_TYPE_LABELS: Record<string, string> = {
  ATRASO: "Atraso",
  SAIDA_ANTECIPADA: "Saída antecipada",
  FALTA: "Falta",
  PROBLEMA_NO_PONTO: "Problema no ponto",
  ESQUECIMENTO: "Esquecimento",
  ATESTADO: "Atestado",
  OUTRO: "Outro",
};

export const OCCURRENCE_STATUS_LABELS: Record<string, string> = {
  PENDING: "Aguardando análise",
  APPROVED: "Aprovada",
  REJECTED: "Rejeitada",
};

export const GOAL_TYPE_LABELS: Record<string, string> = {
  REVENUE: "Valor em vendas",
  SALES_COUNT: "Quantidade de vendas",
};

export const GOAL_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Ativa",
  ACHIEVED: "Atingida",
  EXPIRED: "Expirada",
  CANCELLED: "Cancelada",
};

// Indicador de risco exibido no card/tabela de metas — sempre com texto,
// nunca só cor (pedido explícito do requisito).
export const GOAL_RISK_LABELS: Record<string, string> = {
  EM_ANDAMENTO: "Em andamento",
  PROXIMO_DA_META: "Próximo da meta",
  ATENCAO: "Atenção",
  ATINGIDA: "Atingida",
  EXPIRADA: "Expirada",
};

export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  GOAL_WARNING: "Aviso de meta",
  GOAL_ACHIEVED: "Meta atingida",
  GOAL_EXPIRED: "Meta expirada",
};

export const DAILY_TIME_CLOCK_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Não iniciado",
  WORKING: "Trabalhando",
  ON_BREAK: "No intervalo",
  FINISHED: "Concluído",
  INCOMPLETE: "Incompleto",
};
