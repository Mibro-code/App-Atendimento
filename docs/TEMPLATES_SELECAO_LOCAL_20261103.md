# Templates individuais — seleção em qualquer ordem

Correção local de 03/11/2026, sem publicação. Fonte: `attendance/public/js/whatsapp-send-wizard.js`.

- Contato pode ser escolhido antes ou depois do template; nome e primeiro nome automáticos acompanham a seleção.
- Preencher o nome por último atualiza a prévia, as variáveis automáticas e o botão, sem reconstruir o formulário ou perder o foco.
- Valores editados manualmente, inclusive apagados intencionalmente, não são substituídos ao trocar de contato ou selecionar novamente o mesmo template.
- Campos obrigatórios pendentes são explicados ao lado do botão: número remetente, nome, telefone, template e variáveis.
- Trocar o número remetente exige selecionar um template desse número; respostas atrasadas da consulta anterior são ignoradas. Selecionar um template diferente reinicia seus valores, evitando carregar dados de outro modelo.
- Nenhuma mudança nas permissões, empresas, regras do WhatsApp, backend ou comportamento de envio em massa.

Validação: `node --check public/js/whatsapp-send-wizard.js` e 22 testes passando, executados dentro de `attendance`: `node --test test/whatsapp-send-wizard-selection.test.js test/bulk-send-rules.test.js test/bulk-send-model.test.js`. Onze testes novos executam os eventos reais do arquivo em memória; chamadas de API são simuladas ou bloqueadas. Sem banco, Meta ou mensagens reais. Não houve teste de envio real ou publicação na VPS.

Backup do arquivo anterior: `C:/App Whats/backups/template-selection-local-20261103/whatsapp-send-wizard.js`. Final de linha CRLF preservado.

A exigência de permissão de campanhas em templates enviados dentro de conversas existentes é uma questão separada e não foi alterada nesta correção.
