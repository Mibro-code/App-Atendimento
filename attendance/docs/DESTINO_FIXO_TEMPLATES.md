# Destino fixo por template WhatsApp

Cada template aprovado da Meta pode ter uma **categoria e subcategoria
internas fixas**. Quando o template abre um novo atendimento, a conversa
nasce nesse destino, sem escolha manual no envio.

## Onde configurar

Campanhas → selecione empresa e número → card **Templates da WABA** →
**Editar destino** em cada template. O card mostra lado a lado:

- **Categoria Meta**: Marketing/Utilidade/Autenticação. É da Meta (cobrança e
  aprovação) e não é alterada.
- **Categoria do atendimento / Subcategoria**: categorias internas da Central.
- **Roteamento**: Ativado, Desativado, Inválido (setor desativado) ou
  Template indisponível (removido, pausado, rejeitado ou recriado na Meta).

Salvar o destino não edita nem reenvia o template para a Meta.

## Precedência no envio

1. **Atendimento ativo**: categoria atual preservada. Só conversas novas
   (sem mensagens WhatsApp) ou finalizadas (novo ciclo) são classificadas.
2. **Destino fixo do template** da WABA do número remetente.
3. **Regra do número**: `ChannelAccount.config.outboundTemplateCategoryId`
   (ex.: Comercial → Atacado). Continua valendo sem configuração de template,
   com regra desativada/inválida ou incompatível com o número.
4. **Triagem**: nenhuma regra, segue o fluxo existente.

A classificação é gravada **depois** que a Meta aceita o envio, na mesma
transação da mensagem e com compare-and-set. Envio rejeitado não muda nada.
Aceitação pela API não é entrega; os status de entrega não reclassificam.

Vale para todos os caminhos que usam `sendApprovedTemplate`: envio na
conversa, Nova conversa, envio em massa/campanhas e envio de teste.
Fluxos de Bot não enviam templates atualmente.

## Identificação

Chave: empresa + WABA + nome + idioma (`TemplateRoutingConfiguration`).
Nomes iguais em WABAs diferentes são regras independentes. O
`metaTemplateId` salvo confirma que é o mesmo template: se ele for recriado
com o mesmo nome, a regra fica pendente de revisão e não é aplicada.

Sincronizar templates não altera as regras. Regra sem template na WABA
aparece em "Destinos preservados sem template disponível".

## Validações

- Categoria principal da mesma empresa, ativa; subcategoria opcional, ativa e
  filha da categoria escolhida.
- O setor precisa ter um número desta WABA em Integrações → Acessos
  (`outboundCategoryIds`). Senão, o envio não teria remetente válido.
- No envio, tudo é revalidado. O destino só vale se o remetente escolhido
  pelas regras de número por setor for o mesmo número do envio.

## Permissões

- Master: configura, ativa/desativa e consulta o histórico.
- Supervisor: somente com `canManageCategories` e `canManageCampaigns` na
  empresa, e apenas em categorias liberadas para ele. Setores protegidos
  (Financeiro) e exclusivos do Master ficam com o Master.
- Atendente: vê o destino e envia templates; não altera (403 no backend).

## Financeiro protegido e atendente fixo

- Destino em setor protegido só é aplicado quando quem envia já pertence ao
  setor (ou em campanhas automáticas sem usuário). A mensagem e o histórico
  nascem com o carimbo privado e `PRIVATE_SEGMENT_STARTED`. Nenhum acesso
  novo é concedido.
- O atendente fixo do contato não é lido nem alterado: o template define o
  setor, o atendente fixo continua definindo o responsável preferencial.

## Auditoria

- Alterações: `AuditLog` com `entityType = TEMPLATE_ROUTING` e ações
  `TEMPLATE_ROUTING_CREATED/UPDATED/ENABLED/DISABLED`. Guarda empresa, WABA,
  template, destino anterior e novo e usuário.
- Classificação: `ConversationActivity CATEGORY_CHANGED` com
  `source = OUTBOUND_TEMPLATE_ROUTING` (ou `OUTBOUND_TEMPLATE_INITIAL_CATEGORY`
  para a regra do número) e `AuditLog CONVERSATION_CATEGORY_CHANGED`.

## Banco

Migration aditiva `20261014120000_template_routing_configuration`: só cria a
tabela `TemplateRoutingConfiguration`, com FKs `RESTRICT` para empresa e
categorias, já que categorias nunca são apagadas. Nenhum dado existente é
alterado.
