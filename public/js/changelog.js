(() => {
  const APP_VERSION = "0.11.0";

  const CHANGELOG = [
    {
      version: "0.11.0",
      date: "20/08/2026",
      title: "Templates da Meta e janela de 24 horas",
      changes: [
        "Detecta automaticamente se a conversa está dentro da janela de atendimento de 24 horas da Meta.",
        "Bloqueia mensagens livres e anexos quando a Meta exige o uso de um template aprovado.",
        "Lista os templates aprovados com nome, idioma, categoria e prévia da mensagem.",
        "Permite preencher as variáveis do template antes do envio.",
        "Exibe um aviso de que o envio por template pode gerar cobrança da Meta.",
        "Registra no histórico da conversa a mensagem enviada por template e o atendente responsável.",
        "Mantém a finalização manual disponível mesmo quando a janela de 24 horas já terminou."
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
