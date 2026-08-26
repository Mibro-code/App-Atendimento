# Credenciais e segredos

## Como são guardadas

- Toda credencial de canal (`ChannelAccount.secrets`) é cifrada com
  AES-256-GCM antes de tocar o banco (`integration-secret-service.js`),
  usando a chave mestra `INTEGRATION_ENCRYPTION_KEY` (32 bytes, hex ou
  base64), lida só no momento da operação — nunca hardcoded.
- Sem `INTEGRATION_ENCRYPTION_KEY`, a aplicação sobe normalmente. Só
  salvar/ler segredo de integração falha com erro claro (503).
- Nenhuma rota da API devolve o valor cifrado nem o texto puro do segredo.
  O painel de Integrações só recebe `secretKeys` (quais campos existem) e
  `secretHints` (máscara com os últimos 4 caracteres).
- Segredos nunca aparecem em log, auditoria (`AuditLog.details` guarda só
  nomes de campo alterados, nunca valor) ou no HTML/JS do frontend.

## Variáveis de ambiente relacionadas (todas opcionais)

| Variável | Uso |
|---|---|
| `INTEGRATION_ENCRYPTION_KEY` | Chave mestra de cifragem dos segredos salvos no painel |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI` | App OAuth para E-mail (Gmail) e Google Reviews |
| `MICROSOFT_OAUTH_CLIENT_ID` / `MICROSOFT_OAUTH_CLIENT_SECRET` / `MICROSOFT_OAUTH_REDIRECT_URI` | App OAuth para E-mail (Microsoft 365) |
| `MERCADO_LIVRE_CLIENT_ID` / `MERCADO_LIVRE_CLIENT_SECRET` / `MERCADO_LIVRE_OAUTH_REDIRECT_URI` | App OAuth do Mercado Livre |

Nenhuma delas é exigida para o app iniciar. Cada canal fica `NOT_CONFIGURED`
até que uma conta seja criada pelo painel.

## Permissões

Todo o CRUD de `ChannelAccount`, o teste de conexão, o fluxo OAuth e a
configuração global (`IntegrationGlobalSettings`) são Master-only
(`channel-account-service.assertIntegrationManager`). Um atendente comum
nunca vê nem uma tela de credencial.
