# Central de Atendimento + CRM + ponte Olist

Snapshot completo dos fontes locais em 03/11/2026, para versionamento e revisão. Inclui mudanças locais ainda não publicadas; não representa uma nova versão implantada.

- attendance/: Central, canais, bots, banco/schema e interface.
- crm/: CRM, integração de identidade, propostas e acompanhamento Olist.
- olist-bridge/: base versionada do aplicativo de integração Shopify/Olist, com os complementos CRM desta entrega. Alterações independentes e não commitadas das seções da loja foram preservadas apenas no checkout original.
- docs/: escopo e limites das mudanças locais.

A produção de referência continua 0.37.19. O novo ciclo de propostas exige homologação real e a migration aditiva original; o Git não autoriza ativar essas mudanças. A correção de seleção de templates de 03/11 é local. O adaptador financeiro legado foi mantido conforme solicitado.

Dependências, builds, ambientes, segredos, bancos, conversas, anexos e relatórios de dados reais não fazem parte desta cópia. Configure as credenciais no ambiente de execução. Não execute seeds, migrations ou scripts de publicação contra produção como verificação.

Consulte [integração](docs/INTEGRACAO.md), [fluxo Olist](docs/FLUXO_OLIST_LOCAL_20261030.md) e [templates](docs/TEMPLATES_SELECAO_LOCAL_20261103.md).
