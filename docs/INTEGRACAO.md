# Integração local entre Atendimento e CRM

> **26/10/2026: 0.37.9 publicada**, com vínculo automático por e-mail em novas contas CRM e controle Master em Equipe → Editar → Acesso ao CRM. [Resultado e backups](docs/RELEASE_0379_ACCESS_20261026.md). A integração e os recursos da 0.37.8 foram preservados; proposta completa no Atendimento continua pendente.

> **23/10/2026: integração publicada na 0.37.8**, revisão `0.37.8-integrated-20261023`. Estado atual e recibos em [publicação integrada](docs/RELEASE_0378_INTEGRATED_20261023.md). As descrições de etapas locais e resultados anteriores abaixo são históricas; não significam que a criação completa de proposta dentro do Atendimento foi entregue.

> Codex: comece pelo [handoff atual](docs/CODEX_HANDOFF.md) e pelo [guia de qualidade](docs/CODEX_QUALIDADE.md). As seções de testes por etapa abaixo são históricas; não representam uma nova execução nem autorizam banco, serviços ou publicação.

> Revisão integrada de 21/10/2026: consulte [o roteiro e os limites da validação](docs/VALIDACAO_INTEGRADA_20261021.md). Prévia com dados fictícios; nada desta integração foi publicado. A suíte legada do Atendimento não está integralmente verde e não é tratada como liberação para produção.

Implementação local em 20/10/2026. Nada publicado, nenhum acesso à VPS nesta etapa e nenhum cadastro real modificado. Esta pasta é uma cópia isolada das fontes previamente capturadas; não substitui os projetos originais.

## Experimentar a prévia

- Atendimento: <http://127.0.0.1:4037/login.html>
- CRM na mesma janela da Central: <http://127.0.0.1:4037/crm>
- Login original do CRM: <http://127.0.0.1:4038/login>

Todos os acessos abaixo são fictícios e exclusivos do PostgreSQL local:

| Conta | E-mail | Senha de teste | Acesso |
| --- | --- | --- | --- |
| Administrador | `owner@local.invalid` | `Attendance-local-20261020!` | Master no Atendimento e administrador no CRM |
| Conta vinculada | `linked@local.invalid` | `Attendance-local-20261020!` | Atendente na Central e supervisor no CRM; demonstra preservação de cargos |
| Representante | `representative@local.invalid` | `Representative-local-20261020!` | Somente CRM, inclusive dentro da janela instalada |
| Somente CRM | `crm-only@local.invalid` | `CRM-only-local-20261020!` | Vendedor do CRM, sem acesso à Central |

O botão CRM aparece na Central para o usuário vinculado. Dentro do CRM, o botão Atendimento aparece somente para quem tem vínculo autorizado e não é representante. A tela de login da Central também oferece entrada separada para CRM/representantes.

O shell `/crm` não concede autenticação nem autorização da Central: apenas exibe o CRM, que conserva sua própria proteção. Portanto um representante pode abrir o CRM dentro do PWA sem receber o cookie `mibro_session`.

Para iniciar novamente, com o PostgreSQL descartável `central-ux-test-20261015` disponível na porta 5559:

```powershell
Set-Location 'C:\App Whats\merge-crm-atendimento-20261020'
node start-local.cjs
```

O inicializador só aceita os schemas locais `merge_attendance_20261020` e `merge_crm_20261020`, usa contas sintéticas, cria chaves efêmeras e não importa `.env`. O bloqueio de rede externa é exclusivo dos processos locais de prévia. Os workers de produção não são iniciados e não há tokens reais de Meta, e-mail ou Shopify.

## O que foi implementado

- As duas telas de login continuam existindo. Para contas vinculadas, o e-mail e a senha principais são os do Atendimento. O e-mail antigo do CRM permanece no cadastro, mas não é uma credencial alternativa para o vínculo.
- Nenhum hash de senha é copiado. Se a validação principal falhar ou estiver indisponível, o CRM não tenta a senha antiga como alternativa.
- Representantes e usuários exclusivos do CRM conservam sua autenticação local. Cada aplicativo mantém seus cargos, IDs, históricos e permissões.
- O CRM valida a sessão principal nas requisições autenticadas. Desativação do usuário, revogação de sessão ou desativação do vínculo bloqueiam o acesso compartilhado. Sessões antigas de contas vinculadas precisam de novo login.
- A prova principal fica apenas no JWT criptografado/HttpOnly do CRM; não aparece em `/api/auth/session`.
- A troca de módulo usa código descartável de 60 segundos, PKCE e estado vinculado ao navegador. Um mesmo código só pode ser consumido uma vez, inclusive com várias instâncias concorrentes.
- As chamadas entre servidores usam assinatura de método, caminho, corpo, horário e nonce persistido. Credenciais têm limitação de tentativas por conta. Só registros efêmeros expirados de segurança são limpos.
- Confirmação por senha no ponto também usa a credencial principal. Redefinição de senha de conta vinculada no CRM orienta a fazê-la pela administração do Atendimento, sem alterar o hash local silenciosamente.
- O CRM só é carregado quando aberto. A validação de autenticação é deduplicada dentro da mesma renderização React, sem cache de sessão compartilhado entre usuários ou requisições.
- O CRM incorporado aceita somente o ancestral configurado. O shell aceita apenas os dois aplicativos. HTML de autenticação, códigos e dados do CRM não são adicionados ao cache do service worker.

O logout do Atendimento revoga a versão da sessão principal e invalida a prova do CRM. O logout feito no CRM encerra sua própria sessão; não substitui o logout da Central.

## Evidências de verificação

| Verificação | Resultado | Evidência |
| --- | --- | --- |
| Política, criptografia, códigos e HTTP com PostgreSQL real | 20 testes passaram | `identity-*.test.cjs` |
| Suite do CRM, incluindo confirmação secundária de senha | 301 testes passaram | Vitest; `crm/src/lib/primary-password.test.ts` |
| Navegador desktop e celular | 8 cenários passaram | `browser-results.json`; `test-browser.cjs` |
| Concorrência no PostgreSQL | Uma vitória em dez trocas simultâneas; nonce não reutilizável | `identity-postgres.test.cjs` |
| Schemas Prisma | Ambos válidos | Clientes locais gerados e schemas de teste sincronizados |
| Duas migrações SQL | Executadas com sucesso em transação local, seguida de `ROLLBACK` | Arquivos `20261020180000_central_identity_bridge/migration.sql` |
| TypeScript e ESLint dos arquivos CRM alterados | Sem erros | `tsc --noEmit`; ESLint |
| Seleção de regressão da Central | 9 passaram; 1 falhou por texto antigo esperado | `app.test.js:108` exige texto ausente também no HTML original capturado |

Não foi executada a suite completa da Central nem o build/container em modo de produção. Não foram medidos ganhos percentuais de desempenho. Os tempos em `browser-results.json` incluem as tarefas do cenário e o modo de desenvolvimento; não representam latência de produção.

Os testes também revelaram e permitiram corrigir o bloqueio do redirecionamento no iframe, a leitura do cookie recém-criado no callback e a normalização de IP local pelo Next dev. O ajuste de normalização está restrito à variável de prévia local.

Para repetir os testes de integração sem concorrência entre fixtures:

```powershell
node --test --test-concurrency=1 identity-policy.test.cjs identity-crypto.test.cjs identity-grants.test.cjs identity-postgres.test.cjs identity-routes.test.cjs
```

Os testes de navegador exigem Playwright e Microsoft Edge. Reinicie a prévia antes de repetir várias suites: o limite real de tentativas de senha é mantido nos testes e pode ser atingido por rodadas sucessivas. Não há endpoint para zerá-lo remotamente.

## Oito vínculos reais: somente planejamento

`confirmed-links.cjs` monta um dry-run com sete correspondências únicas por e-mail e o vínculo manual confirmado do proprietário. Inativos, representantes e ambiguidades não são ativados. O script não escreve no banco.

Ainda é necessário revalidar o inventário quando houver autorização de publicação. Não foram criados nem habilitados os oito vínculos nos bancos reais. Se o e-mail principal mudar posteriormente, o alias de vínculo também precisa ser atualizado com validação de unicidade.

## Preparar WhatsApp com contatos do CRM

Acesse **WhatsApp · selecionar contatos** no menu do CRM, ou <http://127.0.0.1:4038/envios-whatsapp>. A escolha confirmada pelo usuário é **empresa por envio**: o cliente continua na carteira única do CRM, sem ganhar empresa proprietária nem ser duplicado no cadastro.

1. Escolha Mibro ou Sincrofit entre as empresas onde sua conta do Atendimento permite campanhas.
2. Busque na carteira permitida pelo CRM. Os filtros incluem nome/telefone, UF e responsável; é possível escolher telefone principal, segundo ou terceiro.
3. Consulte o histórico separado da empresa: último registro, status, número e autor efetivo do envio. Não se usa o responsável atual da conversa como se ele tivesse enviado a mensagem. Se o remetente não foi registrado, o painel informa isso sem adivinhar.
4. Selecione até 500 contatos e clique em **Revisar na Central**. A seleção é deduplicada por telefone e seus IDs de CRM são preservados. Nenhuma mensagem é enviada ao selecionar ou navegar para a Central.
5. Revise o número, templates aprovados, variáveis e custos no assistente já existente. A confirmação utiliza a mesma fila, opt-out, limites e processamento de status de campanhas.

O campo de interesse por marca não vira regra de propriedade. Trocar a empresa limpa a seleção da tela, e o servidor impede usar a seleção com um remetente de outra empresa. O servidor também relê os IDs da carteira e seus telefones ao preparar a seleção; não aceita nomes/telefones fabricados no navegador.

### Reenvio, sincronização e limites de visibilidade

- A opção **ignorar contatos com envio registrado** começa ligada. Pode ser desligada para um reenvio intencional. Contatos com envio pendente em campanha ativa e opt-out continuam bloqueados. Uma mesma seleção não cria dois lotes, mesmo com nova chave de pedido.
- Uma campanha em rascunho ou cancelada não é apresentada como envio ativo na fila. Uma tentativa que falhou não é apresentada como entrega nem como envio bem-sucedido.
- Master consulta o histórico autorizado da empresa. Para os demais usuários, este resumo conservador consulta seus próprios envios nas conversas visíveis e suas próprias campanhas; não amplia permissões de número, histórico de transferência ou setor privado. Não há conteúdo de mensagens na resposta do CRM.
- “Sem registro no seu acesso” não significa “esta pessoa nunca recebeu mensagem”. O cruzamento por telefone também não comprova identidade da pessoa; números compartilhados não fundem cadastros.
- Cadastros marcados **somente telefone** são bloqueados no servidor para o campo escolhido. Um telefone no CRM não comprova consentimento; a integração não marca consentimento automaticamente.
- O histórico é consultado ao abrir/buscar a lista, pelo botão de atualização e a cada 30 segundos enquanto a tela está visível e conectada. Não existe cópia permanente de todos os contatos nem sincronização destrutiva de nomes ou históricos.
- A seleção é um snapshot temporário de 15 minutos, vinculado ao usuário e à empresa. O escopo do CRM é revalidado na criação do snapshot; ele não substitui um mecanismo de revogação retroativa de dados já exportados. A Central revalida suas próprias permissões, vínculo, empresa, histórico, opt-out e seleção durante a revisão e criação do lote.
- Envios futuros pela integração registram `CampaignContact.crmCustomerIds`; registros antigos sem esse vínculo são consultados pelo telefone. Assim, campanhas vinculadas podem continuar identificáveis quando o telefone do cadastro mudar.

### Testes desta etapa

Foram aprovados **28 testes de integração**, incluindo os 20 anteriores e oito de contatos/seleção; **301 testes do CRM**; cinco cenários novos de navegador; TypeScript e ESLint dos arquivos alterados. O SQL da migração `20261020200000_crm_contact_selection` foi executado em uma transação local e revertido integralmente.

As evidências novas estão em `crm-contacts.test.cjs`, `crm-contacts-browser-results.json`, `test-crm-contacts-browser.cjs`, `preview-crm-contacts.png` e `preview-crm-bulk-review.png`. Os testes de navegador verificam empresa obrigatória, histórico distinto Mibro/Sincrofit, representante bloqueado, carteira atual, empresa proibida, marcação somente telefone e abertura do assistente sem criação de campanha. Os testes de fila usam adaptador simulado e verificam **zero chamadas de envio**.

A prévia contém somente contatos, mensagens de exemplo e templates fictícios. A tela pode exibir “Entregue” no histórico sintético para demonstrar os estados; isso não indica um disparo de teste pela Meta. Workers reais não são executados. As pendências de publicação abaixo continuam obrigatórias.

## Consultar o CRM durante uma conversa

Implementado somente nesta prévia local, sem publicação, sem alterações em contas reais e sem migração adicional nesta etapa.

1. Entre no Atendimento local e abra uma conversa WhatsApp. Clique em **CRM**, ao lado do nome do contato. A mesma ficha fica disponível na aba CRM do painel lateral.
2. Consulte contato, vendedor do CRM, etapa comercial, localidade/e-mail quando preenchidos e até três propostas recentes **da empresa da conversa**. O vendedor do CRM não substitui o responsável pelo chat.
3. Clique em **Abrir cadastro no CRM** para navegar na mesma janela/PWA. O destino é limitado a rotas permitidas e preservado pelo estado assinado do SSO; não há redirecionamento arbitrário.
4. No cadastro do CRM, use **Conversas no Atendimento**, escolha explicitamente a empresa e abra uma das conversas permitidas. São mostradas até 20, mais recentes primeiro. Abrir não assume, transfere, cria conversa nem envia mensagem. A leitura normal da conversa pode marcá-la como lida, conforme o comportamento existente do Atendimento.

A ficha exige vínculo ativo e permissões nos dois sistemas. Não exige permissão de campanhas. Representantes não acessam os dados integrados. Sem correspondência na carteira visível, a tela não afirma que o cadastro inexiste globalmente. Telefones duplicados mostram candidatos e aviso; não se cria associação permanente, não se fundem contatos nem se altera a carteira. A busca utiliza telefones principal, segundo e terceiro com variantes exatas, nunca busca por sufixo.

O cadastro do CRM continua compartilhado, conforme a escolha anterior de empresa por operação. Interesse por marca não é propriedade. Etapa e vendedor exibidos pertencem ao cadastro compartilhado; propostas são filtradas pela marca da empresa atual. Empresa desconhecida não faz fallback para propostas de outra marca.

### Carregamento e testes da ficha

A ficha carrega somente ao clicar em CRM. Não adiciona consulta ao recebimento de mensagem; 100 atualizações consecutivas da mesma conversa mantêm o mesmo iframe. Trocar de conversa limpa a ficha anterior, e requisições React são canceladas ao trocar de parâmetros. Não há polling da ficha ou cache compartilhado de dados dos usuários. Use **Atualizar** para reler os dados. Consultas são limitadas, selecionam apenas os campos exibidos e não retornam conteúdo de mensagens.

Verificações aprovadas: seis testes de serviço/UI isolada, oito cenários de navegador, 303 testes do CRM, TypeScript e ESLint dos arquivos alterados. Evidências: `conversation-context.test.cjs`, `test-conversation-context-browser.cjs`, `conversation-context-browser-results.json`, `preview-conversation-crm.png` e `preview-conversation-crm-mobile.png`. Navegador cobre empresa, propostas separadas por marca, navegação nos dois sentidos, ausência de carregamento antes do clique, duplicidade, carteira, representante e leitura por atendente sem permissão de campanhas. Todos os dados são fictícios, e o bloqueio de conexões externas continua ativo.

Não se mediu ganho percentual, RAM ou latência de mensagens sob carga de produção nesta etapa. Build de produção, HTTPS/proxy e PWA instalado continuam pendentes; testes de desenvolvimento não substituem essa homologação. As extensões operacionais abaixo foram acrescentadas depois desta primeira ficha. Atribuição de vendas a campanhas foi expressamente adiada pelo usuário.

## Avisar sobre contato anterior em outra empresa

Um número com mensagem de saída registrada por outra empresa gera **aviso**, não bloqueio. O aviso aparece na seleção de contatos do CRM, na revisão do lote, na confirmação de uma nova conversa, no chat e antes de agendar/colocar/retomar uma campanha. No envio individual é possível cancelar ou continuar conscientemente. Uma consulta indisponível não é apresentada como ausência de contato: o envio manual pede confirmação para continuar sem a verificação.

O sinal considera mensagens `ENVIADA`, `ENTREGUE` e `LIDA`, além de contatos de campanha `SENT`, `DELIVERED`, `READ` e `REPLIED`. Mensagens apenas recebidas, pendências e falhas não comprovam saída bem-sucedida. “Já recebeu contato” não significa entrega confirmada, leitura, resposta, consentimento ou identidade da pessoa. Números compartilhados continuam sem fusão de cadastro.

Este é um sinal mínimo entre empresas, autorizado especificamente para evitar abordagem duplicada. O usuário precisa de permissão na empresa/número de destino, ou poder agir na conversa atual. O nome da empresa de origem só aparece se ela estiver no acesso do usuário; caso contrário, aparece **outra empresa com acesso restrito**. Nunca são retornados texto, atendente, conta, template, horário, IDs ou link da conversa da origem. O aviso não amplia a visibilidade do CRM, da caixa de entrada ou dos setores privados. Opt-out continua separado por empresa.

A checagem usa consultas em lote de até 500 telefones, com variantes exatas. O chat antecipa a consulta ao abrir a conversa e mantém somente um cache curto, em memória e limitado a 20 entradas; não consulta a cada atualização de mensagem. A confirmação aceita é reaproveitada no contexto. A revisão com seleção do CRM reutiliza os resultados que já foram consultados. A criação efetiva do lote não repete consultas de aviso que não alteram sua elegibilidade. Os workers, a janela do WhatsApp e as validações de envio não foram substituídos.

## Usar as novas ações comerciais

| Ação | Onde usar | Limite de segurança |
| --- | --- | --- |
| Revisar cadastro de lead | Ficha CRM da conversa sem correspondência na carteira visível | Preenche nome, telefone e origem autorizados; cadastro exige revisão e confirmação no formulário existente. Não cria cliente automaticamente nem funde duplicados. |
| Agendar retorno | Ficha CRM → Retorno e proposta → Agendar | Usa a agenda do CRM e suas permissões/lembretes internos existentes. Não cria uma segunda agenda nem envia WhatsApp automático. |
| Preparar proposta | Ficha CRM → Retorno e proposta → Preparar proposta desta empresa | Abre a calculadora existente com cliente e marca corretos. Nenhum preço é calculado pelo Atendimento. |
| Revisar resumo no WhatsApp | Proposta no CRM → Enviar pelo Atendimento | Prepara resumo textual da proposta conferida, não PDF. Escolha um telefone habilitado para WhatsApp e revise antes de enviar. |
| Consultar linha do tempo | Ficha CRM → Linha do tempo | Combina até 50 registros recentes permitidos: atividades, agenda, propostas, vendas ligadas ao Olist e metadados de mensagens. Não retorna o conteúdo das mensagens. |
| Segmentar contatos | WhatsApp · selecionar contatos | Etapa comercial, produto de interesse, cidade e compra registrada, além dos filtros anteriores. Os filtros são aplicados no servidor à carteira permitida, não somente à página atual. |

O resumo de proposta tem no máximo 3.500 caracteres e contém o total armazenado no CRM. Não inventa validade, condições, link público, PDF ou aprovação. Seu rascunho dura 15 minutos, fica vinculado a usuário/CRM/empresa/telefone e usa o armazenamento temporário já existente com finalidade explícita. Um rascunho comercial não pode ser reaproveitado como lote. Não é criada migração adicional nesta extensão.

Preparar o resumo não cria conversa, mensagem ou pedido. Só é possível escolher uma conversa operacional do telefone na empresa da proposta. Sem conversa permitida, a tela orienta retomar pelo fluxo de template aprovado. Ao abrir, o texto fica no compositor para revisão. A janela de 24 horas é revalidada pelo serviço normal de envio e não é contornada pelo rascunho. O botão **Desvincular proposta** remove a associação antes do envio, e trocar de conversa também a limpa. Após envio textual efetivo com vínculo válido, a referência é salva junto à mensagem em `rawPayload.crmProposal`; preparar não marca a proposta como enviada nem como venda.

Na timeline, atividades e agenda sem marca são identificadas como cadastro compartilhado do CRM; propostas e vendas com marca são limitadas à empresa escolhida. Não-Masters recebem somente metadados dos próprios envios visíveis no Atendimento. Setores privados e números continuam recortados pelos serviços existentes. A timeline carrega somente quando solicitada; feche e reabra para atualizar.

A confirmação de venda, comissão, atualização do funil e follow-ups automáticos já existentes continuam seguindo o fluxo do **Olist**. Não foram alteradas as regras de `syncOlistOrderStatus`. **Relatório de campanha → venda e qualquer atribuição automática ficaram fora do escopo, a pedido do usuário.**

## Conferir o visual neutro

O CRM mantém temas claro/escuro, menus e papéis existentes. As superfícies foram alinhadas à Central: cinzas neutros, bordas discretas, menos sombras e laranja reservado para foco/navegação. A barra lateral tem rolagem própria; os menus mobile e a navegação entre sistemas permanecem disponíveis. Não foram removidas funções de representantes.

As capturas `preview-crm-neutral-desktop.png`, `preview-crm-neutral-mobile.png` e `preview-crm-neutral-light.png` usam somente dados fictícios. Para revisar, abra o CRM local ou a opção CRM na Central.

### Verificações desta extensão

- 303 testes do CRM aprovados; TypeScript e ESLint dos arquivos alterados aprovados.
- Cinco testes isolados do aviso, seis da ficha/UI, dois de proposta com banco/provedor simulado, oito de regressão de contatos e os testes anteriores de identidade.
- Oito cenários novos em `integrated-operations-browser-results.json`: aviso não bloqueante, revisão do lote, lead sem criação automática, timeline/agenda, resumo sem mensagem/pedido, filtros no servidor, tema responsivo e representante/empresa proibidos. Incluem aviso genérico para atendente que só pode responder, sem expor a empresa restrita.
- Regressões adicionais dos atalhos, CRM/Atendimento e seleção de contatos continuam nos scripts de navegador anteriores. Testes de banco que revogam o mesmo usuário fictício devem executar sequencialmente (`--test-concurrency=1`), não em paralelo sobre o mesmo schema.

Todos os testes usam os schemas descartáveis de loopback. A simulação do serviço de texto confirma que a validação da janela continua sendo chamada e que mensagens comuns mantêm seu formato anterior. Não houve envio real. Build de produção, matriz de desempenho sob carga, HTTPS/proxy e instalação física do PWA continuam pendentes antes de qualquer publicação.

## Contatos, busca e avisos integrados — extensão de 20/10

Implementados localmente os itens aprovados 3 a 6 e as duas solicitações adicionais. Guia técnico e limites em [CRM_CONTATOS_BUSCA_AVISOS.md](docs/CRM_CONTATOS_BUSCA_AVISOS.md).

- **Importar contato:** abra o nome do cliente no cabeçalho → **Dados e CRM**. Nome e WhatsApp vêm preenchidos; revise e use **Enviar para o CRM**. Também há acesso pelo Perfil 360°. O destino é a carteira do usuário, com etapa inicial padrão do CRM, sem trocar o responsável do atendimento ou enviar mensagens.
- **Vínculo explícito:** cadastros semelhantes aparecem para confirmação. Nunca há fusão automática. Um vínculo existente não pode ser sobrescrito; criação e vínculo são transacionais. O vínculo continua funcionando nos dois sentidos após mudar o telefone, sempre revalidando os acessos atuais.
- **Templates:** em Nova conversa → envio individual, use **Buscar contato da Central** por nome ou telefone. Clique no resultado para preencher os campos. A busca continua restrita à empresa e às conversas operacionais permitidas.
- **Busca integrada e avisos:** botões no cabeçalho da Central e opções no menu do CRM. Conversas da empresa escolhida; clientes da carteira permitida; propostas e pedidos da marca correspondente. Retornos, compromissos, avisos existentes e atualizações Olist são consultados sob demanda, sem uma segunda rotina de notificações push/toasts.
- **Retomar trabalho:** rascunho textual por conversa, filtros, conversa aberta e posição da lista no Atendimento; última tela, filtros da URL e posição vertical no CRM. Estado limitado à aba e a duas horas, separado por usuário. Arquivos, áudios, histórico e credenciais não são persistidos. Formulários arbitrários do CRM não têm salvamento automático novo.

A migração `crm/prisma/migrations/20261020160000_central_contact_link/migration.sql` adiciona somente a tabela de vínculo. Foi aplicada **apenas** no schema CRM descartável local. Para preparar outra cópia desse mesmo banco local, use `node apply-local-contact-link.cjs`; esse script rejeita destinos fora do loopback/schema de testes. Não é um script de publicação nem substitui o processo de migração/backup de produção.

Verificações: 305 testes do CRM; testes específicos de identidade, ficha, estado de sessão, contatos, aviso e propostas; TypeScript/ESLint; cenários reais de navegador em `contact-integration-browser-results.json` e regressão da ficha em `conversation-context-browser-results.json`. Incluem concorrência de três importações, uma única criação persistida, troca de telefone, escopos e representantes. Todos com dados fictícios, sem envios reais. Não há ganho percentual de desempenho medido nesta extensão.

## Central de Atividades — extensão de 21/10

Botão **Atividades** na Central e item **Central de Atividades** no CRM. A tela reúne a Agenda do CRM, a recompra e os retornos da Agenda da Central da empresa escolhida, sem copiar registros entre bancos. Concluir e reagendar seguem as regras do sistema de origem. Não há migração nem worker novo, e nada envolvendo Olist foi alterado. Auditoria, testes, pendências, publicação e rollback estão em [CENTRAL_ATIVIDADES.md](docs/CENTRAL_ATIVIDADES.md).

## Antes de qualquer publicação futura

1. Aprovar a prévia e revisar a integração completa com as alterações posteriores de ambos os projetos.
2. Executar build/container em modo de produção, testes HTTPS/proxy e validação em um PWA realmente instalado. A automação atual cobre a mesma janela em navegador, não a instalação física.
3. Executar a matriz completa de regressão e desempenho, incluindo chegada de mensagens, botões, bot e permissões por empresa.
4. Fazer backups separados dos dois bancos e das configurações. As migrações adicionam estruturas de identidade, seleção e vínculo de contatos; não reescrevem usuários ou mensagens.
5. Configurar `CENTRAL_IDENTITY_SECRET` independente, os dois endereços públicos e habilitar `CENTRAL_IDENTITY_ENABLED` coordenadamente. O build do CRM deve receber a mesma configuração de origens para gerar a política de enquadramento correta.
6. Revalidar e preparar vínculos unívocos com os mesmos IDs. Planejar ativação, verificação e reversão antes de trocar a autoridade das credenciais. Não existe aplicação automática desse plano nesta pasta.

Este documento não autoriza publicação. A VPS permanece fora do escopo desta etapa.
