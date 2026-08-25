// Arquitetura-base para ferramentas que o motor de Bots poderá executar no
// futuro. Regra obrigatória: a IA interpreta, o BACKEND executa — nenhuma
// tool aqui é chamada pelo interpretador/orquestrador nesta fase, e nenhuma
// delas integra com sistemas externos ainda (Shopify, Olist, etc.).
//
// Cada entrada descreve o contrato esperado (nome, propósito e o formato de
// entrada/saída), mas `run` sempre falha explicitamente até que a
// integração real seja implementada em uma fase futura.

function notImplemented(toolName) {
  return async function run() {
    throw new Error(`${toolName} ainda não está implementada nesta fase.`);
  };
}

const tools = {
  OrderTool: {
    description: "Consultar dados de um pedido pelo número, CPF/CNPJ ou e-mail do cliente.",
    input: { orderNumber: "string?", cpf: "string?", cnpj: "string?", email: "string?" },
    run: notImplemented("OrderTool"),
  },
  TrackingTool: {
    description: "Consultar status de rastreio de uma entrega pelo código de rastreio ou pedido.",
    input: { trackingCode: "string?", orderNumber: "string?" },
    run: notImplemented("TrackingTool"),
  },
  PaymentTool: {
    description: "Consultar status de pagamento de um pedido.",
    input: { orderNumber: "string" },
    run: notImplemented("PaymentTool"),
  },
  ProductTool: {
    description: "Consultar informações de um produto pelo nome ou SKU.",
    input: { productName: "string?", sku: "string?" },
    run: notImplemented("ProductTool"),
  },
  SerialNumberTool: {
    description: "Validar um número de série e retornar dados de garantia associados.",
    input: { serialNumber: "string" },
    run: notImplemented("SerialNumberTool"),
  },
  WarrantyTool: {
    description: "Consultar a situação de garantia de um produto.",
    input: { serialNumber: "string?", orderNumber: "string?" },
    run: notImplemented("WarrantyTool"),
  },
  ShopifyTool: {
    description: "Consultar/atualizar dados de pedidos e produtos na Shopify.",
    input: { orderNumber: "string?", productId: "string?" },
    run: notImplemented("ShopifyTool"),
  },
  OlistTool: {
    description: "Consultar/atualizar dados de pedidos e estoque no Olist.",
    input: { orderNumber: "string?", sku: "string?" },
    run: notImplemented("OlistTool"),
  },
};

function getTool(name) {
  return tools[name] || null;
}

function listTools() {
  return Object.entries(tools).map(([name, tool]) => ({ name, description: tool.description, input: tool.input }));
}

module.exports = { getTool, listTools, tools };
