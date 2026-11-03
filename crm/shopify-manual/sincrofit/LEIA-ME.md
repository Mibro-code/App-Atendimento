# Correção do modo CRM na calculadora Sincrofit

1. No projeto do app Shopify, crie `app/routes/apps.cnpj-validator.crm.session.jsx` com o conteúdo do arquivo de mesmo nome desta pasta.
2. Confirme no `.env` do app Shopify:
   - `CRM_API_URL=https://crm.mibrobrasil.com.br`
   - `CRM_SHOPIFY_SHARED_SECRET=<a chave gerada>`
3. Faça o deploy/restart do backend do app Shopify.
4. No editor de código do tema Sincrofit, abra a seção Liquid usada em `/pages/sincrofit`.
5. Dentro do IIFE principal, localize no fim:

   ```js
   calculate();
   loadWholesaleMode();
   ```

6. Cole o conteúdo de `bootstrap-crm-session.js` no lugar dessas duas linhas. O próprio arquivo já termina com as três chamadas na ordem correta.
7. Salve o tema e gere um link novo no CRM. Tokens antigos ou já resolvidos não funcionam novamente.

O segredo fica somente no `.env` do backend. Nunca cole a chave no Liquid.
