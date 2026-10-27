"use client";

import { useEffect, useState } from "react";

interface TutorialStep {
  area: string;
  title: string;
  body: string[];
  tip?: string;
}

const STEPS: TutorialStep[] = [
  {
    area: "Introdução",
    title: "Como usar o Portal Comercial",
    body: [
      "Este guia explica as áreas principais do sistema, o que cada uma mostra e quais ações estão disponíveis para vendedores, representantes, supervisores e administradores.",
      "Use Próximo e Voltar para navegar. Você também pode selecionar qualquer etapa pela barra superior ou reabrir este guia em Meu perfil sempre que precisar.",
    ],
  },
  {
    area: "Visão geral",
    title: "Painel comercial",
    body: [
      "O Painel reúne os indicadores mais importantes do seu trabalho: clientes, propostas, vendas, follow-ups, conversão e metas. Os números respeitam o seu nível de acesso.",
      "Vendedores e representantes veem apenas a própria carteira. Supervisores acompanham a equipe vinculada e administradores possuem a visão geral permitida pelo sistema.",
      "Avisos operacionais, como ponto pendente e pedidos do dia, também aparecem aqui quando forem aplicáveis ao seu perfil.",
    ],
    tip: "Comece pelos avisos pendentes e pelos follow-ups atrasados antes de analisar os demais indicadores.",
  },
  {
    area: "Carteira",
    title: "Clientes, filtros e funil",
    body: [
      "A tela Clientes mostra a carteira disponível para o seu perfil. Pesquise por nome, razão social ou CPF/CNPJ e combine filtros como vendedor, estado, status, temperatura, origem, segmento e empresa de interesse.",
      "O funil organiza os clientes em Novos, Em atendimento, Follow-up de recompra, Cotação, Vendidos, Reciclagem e Inativos. Use “Registrar contato” para marcar cada tentativa. Após 3 tentativas no follow-up de recompra, escolha entre Reciclagem ou Inativos.",
      "Exportação, seleção em massa e repasse seguem as permissões definidas no backend. Um vendedor nunca consegue consultar ou transferir uma carteira fora do seu alcance.",
    ],
    tip: "Os botões WhatsApp e E-mail iniciam o contato diretamente quando esses dados estiverem cadastrados.",
  },
  {
    area: "Cadastro",
    title: "Cadastrar ou importar clientes",
    body: [
      "No cadastro individual, o nome do contato é obrigatório. Complete razão social, CPF/CNPJ, telefone, e-mail, endereço, estado, tipo de negócio, segmento, interesses e empresa de interesse sempre que possível.",
      "Na importação por planilha, o sistema reconhece os cabeçalhos suportados, apresenta uma prévia e informa linhas com dados inválidos ou possíveis duplicidades antes da confirmação.",
      "Quando encontrar um cliente repetido, revise os registros e use a opção de mesclar para preservar e complementar as informações em vez de criar duas fichas.",
    ],
    tip: "A localização é solicitada para registrar a origem comercial do cadastro. Se for recusada ou estiver indisponível, o cadastro continua e o sistema poderá solicitar novamente em outra ação.",
  },
  {
    area: "Relacionamento",
    title: "Ficha completa do cliente",
    body: [
      "A ficha concentra dados cadastrais, responsável atual, status, temperatura, interesses, atividades, follow-ups, propostas, vendas e histórico de alterações.",
      "Use Editar cliente para completar ou corrigir informações. Em Registrar atividade, selecione o canal utilizado, descreva o contato e informe o próximo passo combinado.",
      "Transferências mantêm todo o histórico, propostas e vendas. A opção só aparece quando sua conta possui permissão e o destinatário está dentro do escopo permitido.",
    ],
  },
  {
    area: "Agenda comercial",
    title: "Follow-up de recompra",
    body: [
      "A área separa em Atrasados, Hoje e Próximos os clientes que já compraram e voltaram para uma nova abordagem comercial.",
      "O prazo automático é configurado por vendedor, com padrão de 30 dias quando não houver uma definição individual. A regra passa a considerar o novo responsável após uma transferência.",
      "Use Adiar para escolher uma nova data ou Contato realizado para concluir o lembrete. Registrar corretamente a interação evita cobranças repetidas e mantém a carteira atualizada.",
    ],
    tip: "Priorize Atrasados e Hoje; depois organize os próximos contatos para não deixar clientes sem retorno.",
  },
  {
    area: "Negociação",
    title: "Propostas e cotações",
    body: [
      "Em Criar proposta, escolha Mibro ou Sincrofit e decida entre simulação e cotação real. O mesmo cliente pode possuir propostas separadas para as duas empresas.",
      "A tela Propostas mostra tipo, empresa, itens, valores, status, datas e histórico. Uma simulação pode ser retomada ou convertida em cotação real sem apagar o registro original.",
      "Cotações em aberto continuam visíveis até o avanço, cancelamento ou conversão. A integração identifica a empresa e associa o retorno à proposta correta.",
    ],
  },
  {
    area: "Resultados",
    title: "Vendas, metas e comissões",
    body: [
      "Vendas reúne os pedidos confirmados pelas integrações e permite acompanhar empresa, cliente, responsável, valor e situação do pedido. A confirmação não é feita manualmente nessa tela.",
      "Em Metas, vendedores acompanham o objetivo do período e o progresso calculado sobre vendas confirmadas. Supervisores e administradores criam ou ajustam metas dentro do próprio alcance.",
      "Representantes não utilizam meta. A comissão deles é calculada pelas regras vigentes no momento da venda e fica visível ao supervisor responsável.",
    ],
  },
  {
    area: "Gestão",
    title: "Minha equipe e permissões",
    body: [
      "Supervisores usam Minha equipe para acompanhar integrantes vinculados, definir dias de follow-up, permitir ou bloquear repasses individuais e configurar comissões de representantes.",
      "O supervisor só acessa a própria equipe. O administrador pode gerenciar usuários, equipes, permissões e transferências globais, além de consultar o histórico de cada conta.",
      "Criação, edição, desativação e exclusão de usuários seguem regras diferentes por papel. Toda alteração relevante registra quem realizou a ação e quais dados foram modificados.",
    ],
    tip: "Se uma opção não aparecer, verifique com o administrador se ela foi liberada para sua conta.",
  },
  {
    area: "Jornada",
    title: "Registro de ponto",
    body: [
      "Vendedores e supervisores registram Entrada, Saída para almoço, Volta do almoço e Saída. O sistema usa a hora do servidor; o funcionário não escolhe nem altera o horário.",
      "Cada registro exige confirmação por passkey do aparelho, como digital ou reconhecimento facial, ou pela senha da conta quando a passkey não estiver disponível.",
      "O painel avisa quando existe uma marcação esperada. O histórico, ocorrências, justificativas e documentos ficam na área Ponto; correções administrativas permanecem auditadas.",
    ],
    tip: "A localização pode ser solicitada no momento do registro, mas o app não realiza rastreamento contínuo em segundo plano.",
  },
  {
    area: "Conta",
    title: "Meu perfil e segurança",
    body: [
      "Em Meu perfil, você atualiza nome, telefone, WhatsApp e senha, consulta sua carteira direta e configura uma passkey compatível com o aparelho.",
      "Cargo, papel, equipe, status e permissões são dados administrativos. Se algum deles estiver incorreto, solicite a alteração ao supervisor ou administrador responsável.",
      "Use Sair da conta ao terminar, principalmente em computadores compartilhados. Nunca compartilhe senha ou aprove uma autenticação que você não iniciou.",
    ],
  },
  {
    area: "Administração",
    title: "Contas, relatórios e mapa comercial",
    body: [
      "Esta área aparece somente para administradores. Ela reúne a gestão de contas, configurações gerais, vendas, relatórios, mapa comercial e acompanhamento de ponto das equipes.",
      "Na conta de cada usuário, o administrador define papel, supervisor, status e permissões individuais. Exclusões, desativações e mudanças de acesso permanecem registradas no histórico da conta.",
      "O mapa utiliza somente localizações registradas durante ações comerciais autorizadas. Os relatórios e exportações sempre aplicam as regras de acesso no servidor, mesmo quando filtros são enviados pela tela.",
    ],
    tip: "Antes de alterar uma permissão, confira o histórico da conta e o supervisor responsável para evitar acesso indevido a outra equipe.",
  },
  {
    area: "Conclusão",
    title: "Pronto para começar",
    body: [
      "Agora você conhece o fluxo principal: cadastrar o cliente, registrar contatos, acompanhar follow-ups, criar propostas e consultar as vendas confirmadas.",
      "As telas e ações exibidas variam conforme o seu papel e as permissões definidas. Reabra este tutorial em Meu perfil sempre que quiser consultar uma área novamente.",
    ],
  },
];

export function TutorialModal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, STEPS.length - 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function openTutorial() {
    setStep(0);
    setOpen(true);
  }

  const current = STEPS[step];
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  return (
    <>
      <button
        type="button"
        onClick={openTutorial}
        className="inline-flex items-center justify-center gap-2 rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
      >
        Tutorial: como usar o app
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl animate-tutorial-in dark:bg-gray-900 sm:max-w-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Tutorial de uso do app"
          >
            {/* Progress dots */}
            <div className="flex items-center gap-1.5 px-6 pt-5">
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Ir para o passo ${i + 1}`}
                  onClick={() => setStep(i)}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${
                    i <= step ? "bg-orange-500" : "bg-gray-200 dark:bg-gray-700"
                  }`}
                />
              ))}
            </div>

            <div className="px-6 pt-6 pb-2 flex items-start justify-between gap-3">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-orange-600 dark:text-orange-300">
                  {current.area}
                </p>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{current.title}</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar tutorial"
                className="rounded-md px-2 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              >
                Fechar
              </button>
            </div>

            <div className="min-h-[230px] space-y-3 overflow-y-auto px-6 pb-5">
              {current.body.map((paragraph, i) => (
                <p key={i} className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                  {paragraph}
                </p>
              ))}
              {current.tip && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2.5 dark:border-orange-900 dark:bg-orange-950/40">
                  <p className="mb-1 text-xs font-semibold text-orange-900 dark:text-orange-100">Orientação</p>
                  <p className="text-xs text-orange-800 dark:text-orange-200 leading-relaxed">{current.tip}</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => (isFirst ? setOpen(false) : setStep((s) => s - 1))}
                className="text-sm font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-2"
              >
                {isFirst ? "Pular" : "Voltar"}
              </button>

              <span className="text-xs text-gray-400 tabular-nums">
                {step + 1} / {STEPS.length}
              </span>

              <button
                type="button"
                onClick={() => (isLast ? setOpen(false) : setStep((s) => s + 1))}
                className="inline-flex items-center justify-center rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
              >
                {isLast ? "Concluir" : "Próximo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
