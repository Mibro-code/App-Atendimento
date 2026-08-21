(() => {
  const APP_VERSION = "0.12.0";

  const CHANGELOG = [
    {
      version: "0.12.0",
      date: "21/08/2026",
      title: "Gerenciamento e simulação de Bots",
      changes: [
        "Adiciona uma área interna de Bots, protegida e disponível somente para contas Master.",
        "Permite criar, editar, ativar, pausar e arquivar configurações de Bots.",
        "Inclui mensagens iniciais, respostas fora do horário, fallback, timezone e categoria padrão.",
        "Permite configurar horários semanais, intenções, prioridades, exemplos, respostas e ações de transferência.",
        "Adiciona um simulador determinístico e local que não envia mensagens nem acessa a API da Meta.",
        "Registra as alterações administrativas de Bots na auditoria geral.",
        "Mantém o bot de triagem, o webhook e a integração WhatsApp Cloud API existentes sem alterações de comportamento."
      ]
    },
    {
      version: "0.11.4",
      date: "21/08/2026",
      title: "Ocultação em cascata de categorias e contatos",
      changes: [
        "Ao ocultar uma categoria principal, as subcategorias associadas são ocultadas automaticamente junto com ela.",
        "Ocultar uma categoria agora também oculta os contatos vinculados a ela na lista geral de atendimento.",
        "Um contato oculto volta a aparecer automaticamente ao receber uma nova mensagem do cliente.",
        "Um contato oculto também reaparece assim que a categoria é reabilitada para a conta.",
        "Abrir diretamente a categoria oculta no atendimento continua exibindo todos os seus contatos normalmente.",
        "A ocultação continua sendo apenas uma preferência visual por conta: acesso, permissões e alertas não são afetados."
      ]
    },
    {
      version: "0.11.3",
      date: "21/08/2026",
      title: "Categorias pessoais e arquivos no chat interno",
      changes: [
        "Permite que cada conta oculte ou restaure individualmente as categorias às quais possui acesso.",
        "Inclui Sem categoria nas preferências individuais de visibilidade.",
        "Mantém os alertas de novas mensagens ativos mesmo quando a categoria está oculta.",
        "Permite enviar qualquer tipo de arquivo no chat interno da equipe, com limite de 100 MB por anexo.",
        "Exibe imagens com prévia e disponibiliza os demais arquivos para download seguro."
      ]
    },
    {
      version: "0.11.2",
      date: "21/08/2026",
      title: "Alertas por leitura e acesso sem categoria",
      changes: [
        "Mantém as conversas em Aguardando resposta mesmo depois que a mensagem do cliente é visualizada.",
        "Interrompe o alerta vermelho, o título piscando e as notificações assim que a mensagem é visualizada.",
        "Marca como visualizadas as novas mensagens que chegam enquanto a conversa está aberta.",
        "Preserva o controle de leitura individual para cada conta Master.",
        "Adiciona Sem categoria ao quadro de categorias liberadas de cada membro da equipe.",
        "Permite definir exatamente quais usuários podem visualizar conversas ainda não classificadas.",
        "Fortalece o controle de leitura para mensagens recebidas com atraso pelo webhook."
      ]
    },
    {
      version: "0.11.1",
      date: "20/08/2026",
      title: "Nova conversa pelo painel",
      changes: [
        "Adiciona o fluxo para iniciar uma conversa informando nome e telefone do contato.",
        "Cria automaticamente o contato e a conversa quando o número ainda não existe.",
        "Reaproveita a conversa existente sem duplicar o contato ou o atendimento.",
        "Exige um template aprovado da Meta para realizar o primeiro envio.",
        "Permite visualizar o template, preencher suas variáveis e revisar o aviso de possível cobrança.",
        "Atribui automaticamente ao atendente a conversa iniciada por ele.",
        "Mantém o recurso desativado com uma explicação enquanto a configuração de templates da Meta não estiver concluída."
      ]
    },
    {
      version: "0.11.0",
      date: "20/08/2026",
      title: "Base para templates da Meta",
      changes: [
        "Prepara a integração com templates aprovados da Meta para ativação futura.",
        "Inclui consulta por nome, idioma, categoria e prévia da mensagem.",
        "Prepara o preenchimento de variáveis e o registro do atendente responsável.",
        "Inclui o aviso de possível cobrança da Meta no fluxo futuro de templates.",
        "Mantém o envio atual funcionando normalmente enquanto a integração não estiver configurada.",
        "O botão de templates e o bloqueio da janela de 24 horas permanecem inativos até a configuração do WABA ID."
      ]
    },

    {
      version: "0.10.5",
      date: "20/08/2026",
      title: "Estabilidade do chat interno",
      changes: [
        "Corrige a atualização em tempo real do chat interno e evita recarregamentos repetidos.",
        "Mantém o cabeçalho e o campo de envio fixos, com rolagem somente no histórico das mensagens.",
        "Melhora o tamanho e a adaptação do chat interno em computadores e telas menores.",
        "Permite que atendentes iniciem conversas diretas com outros membros ativos da equipe.",
        "Atualiza automaticamente o acesso aos chats de setor conforme as permissões de cada usuário.",
        "Inclui o nome personalizado do contato na busca e nos registros internos.",
        "Mantém a sinalização manual de encaminhamento compacta e sem exibir dados do cliente."
      ]
    },

    {
      version: "0.10.4",
      date: "20/08/2026",
      title: "Chat interno e notificações",
      changes: [
        "Simplifica as notificações de clientes para mostrar apenas quem enviou uma mensagem.",
        "Adiciona notificações simplificadas para mensagens do chat interno.",
        "Atualiza o chat interno em tempo real sem precisar fechar e abrir a janela.",
        "Aumenta e padroniza o tamanho do chat interno.",
        "Mantém a barra de envio fixa e deixa apenas o histórico das mensagens rolável.",
        "Remove avisos automáticos de transferência entre setores.",
        "Adiciona sinalização manual de encaminhamento no chat interno.",
        "Simplifica o aviso de encaminhamento para uma linha discreta."
      ]
    },

    {
      version: "0.10.3",
      date: "19/08/2026",
      title: "Nome personalizado e atribuição automática",
      changes: [
        "Adiciona nome personalizado para contatos sem sobrescrever o nome recebido pelo WhatsApp.",
        "Exibe o nome personalizado com prioridade sobre o nome do WhatsApp.",
        "Adiciona edição manual do nome do contato diretamente no atendimento.",
        "Altera a finalização automática por inatividade para 24 horas.",
        "Quem envia uma mensagem passa a assumir automaticamente a conversa."
      ]
    },

    {
      version: "0.10.2",
      date: "19/08/2026",
      title: "Correções e melhorias do chat interno",
      changes: [
        "Corrigido problema em que o histórico do chat interno podia desaparecer após uma atualização.",
        "Corrigida a sincronização das notificações de mensagens não lidas.",
        "Chat interno agora permite enviar mensagens pressionando Enter.",
        "Shift + Enter adiciona uma nova linha sem enviar a mensagem.",
        "Imagens podem ser coladas diretamente da área de transferência nas conversas do WhatsApp.",
        "Imagens podem ser coladas diretamente da área de transferência no chat interno.",
        "Corrigido o envio de imagens no chat interno.",
        "Melhorias no sistema de atualização e cache do aplicativo."
      ]
    },

   {
  version: "0.10.1",
  date: "19/08/2026",
  title: "Envio rápido de mensagens e imagens",
  changes: [
    "Chat interno agora envia mensagens com Enter.",
    "Shift + Enter mantém a quebra de linha.",
    "Imagens podem ser coladas diretamente da área de transferência nas conversas do WhatsApp.",
    "Imagens podem ser coladas diretamente da área de transferência no chat interno.",
    "Novo preview de imagem antes do envio no chat interno."
  ]
},
{
  version: "0.10.0",
  date: "19/08/2026",
  title: "Chat interno e melhorias de atendimento",
  changes: [
    "Novo chat interno entre usuários do aplicativo.",
    "Chat geral, chats por setor e conversas diretas entre membros da equipe.",
    "Contador individual de mensagens não lidas no chat interno.",
    "Avisos automáticos de transferência de atendimento no chat do setor de destino.",
    "Leitura individual de novas mensagens para contas Master.",
    "Leitura compartilhada das notificações entre Supervisores e Atendentes.",
    "Nome do contato do WhatsApp atualizado automaticamente quando disponível.",
    "Novo painel com versão atual e histórico de atualizações do aplicativo.",
    "Novo controle compacto para verificar atualizações disponíveis."
  ]
},
    {
      version: "0.9.2",
      date: "13/08/2026",
      title: "Auditoria e controle de acesso",
      changes: [
        "Auditoria geral para contas Master.",
        "Novas permissões individuais para membros da equipe.",
        "Permissão para visualizar histórico das conversas.",
        "Permissão para visualizar mensagens anteriores após transferências."
      ]
    },
    {
      version: "0.9.1",
      date: "12/08/2026",
      title: "Organização do atendimento",
      changes: [
        "Categorias e subcategorias de atendimento.",
        "Fixação individual de conversas.",
        "Melhorias no acompanhamento e transferência entre atendentes.",
        "Ajustes no fluxo de conversas aguardando resposta."
      ]
    },
    {
      version: "0.9.0",
      date: "10/08/2026",
      title: "Base funcional da Central de Atendimento",
      changes: [
        "Painel central de conversas do WhatsApp.",
        "Recebimento e envio de mensagens.",
        "Controle de responsável por conversa.",
        "Estados Novo, Em atendimento, Aguardando resposta, Bot e Finalizado."
      ]
    }
  ];

  const $ = (selector) => document.querySelector(selector);

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    })[char]);
  }

  function storageKey() {
    const userId =
      window.state?.currentUser?.id ||
      document.querySelector("#current-user")?.textContent ||
      "anonymous";

    return `mibro-changelog-seen:${userId}`;
  }

  function renderChangelog() {
    const list = $("#changelog-list");
    if (!list) return;

    const current = CHANGELOG[0];

    $("#app-version-label").textContent = `v${APP_VERSION}`;
    $("#changelog-current-version").textContent = `v${APP_VERSION}`;
    $("#changelog-current-date").textContent = current.date;

    list.innerHTML = CHANGELOG.map((release, index) => `
      <article class="changelog-release ${index === 0 ? "current" : ""}">
        <div class="changelog-release-heading">
          <div>
            <span>v${escapeHtml(release.version)}</span>
            ${index === 0 ? '<b>Atual</b>' : ""}
          </div>
          <time>${escapeHtml(release.date)}</time>
        </div>

        <h3>${escapeHtml(release.title)}</h3>

        <ul>
          ${release.changes
            .map((change) => `<li>${escapeHtml(change)}</li>`)
            .join("")}
        </ul>
      </article>
    `).join("");
  }

  function syncUnreadDot() {
    const dot = $("#changelog-unread-dot");
    if (!dot) return;

    let seenVersion = null;

    try {
      seenVersion = localStorage.getItem(storageKey());
    } catch {}

    dot.hidden = seenVersion === APP_VERSION;
  }

  function markCurrentVersionSeen() {
    try {
      localStorage.setItem(storageKey(), APP_VERSION);
    } catch {}

    syncUnreadDot();
  }

  function openChangelog() {
    renderChangelog();
    markCurrentVersionSeen();

    const dialog = $("#changelog-dialog");

    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderChangelog();
    syncUnreadDot();

    $("#changelog-button")?.addEventListener("click", openChangelog);

    $("#close-changelog")?.addEventListener("click", () => {
      $("#changelog-dialog")?.close();
    });

    $("#changelog-dialog")?.addEventListener("click", (event) => {
      if (event.target === $("#changelog-dialog")) {
        $("#changelog-dialog").close();
      }
    });
  });

  window.MibroChangelog = {
    version: APP_VERSION,
    releases: CHANGELOG,
    render: renderChangelog
  };
})();
