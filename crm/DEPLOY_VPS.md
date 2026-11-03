# Deploy do CRM na VPS Mibro

O CRM roda no mesmo Droplet do app Shopify, mas com projeto Compose, banco e
volume próprios. Apenas o container web entra na rede externa
`shopify-proxy`; o PostgreSQL não publica porta e fica na rede privada do CRM.

## Destino

- Diretório: `/opt/mibro-crm`
- Domínio: `https://crm.mibrobrasil.com.br`
- Rede compartilhada com o Caddy: `shopify-proxy`
- Health check: `GET /api/health`

## Primeiro deploy

1. Copie o código para `/opt/mibro-crm`.
2. Copie `.env.production.example` para `.env.production`, preencha os
   segredos e aplique `chmod 600 .env.production`.
3. Confirme que a rede existente está disponível:

   ```sh
   docker network inspect shopify-proxy >/dev/null
   ```

4. Construa a imagem, aplique migrations e suba o app:

   ```sh
   docker compose --env-file .env.production -f docker-compose.production.yml build
   docker compose --env-file .env.production -f docker-compose.production.yml up -d db
   docker compose --env-file .env.production -f docker-compose.production.yml --profile tools run --rm migrate
   docker compose --env-file .env.production -f docker-compose.production.yml up -d app
   ```

5. Adicione o conteúdo de `Caddyfile.production` ao Caddyfile em
   `/opt/mibro-shopify/Caddyfile`, valide e recarregue o Caddy:

   ```sh
   cd /opt/mibro-shopify
   docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
   docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
   ```

6. Depois que o DNS A de `crm.mibrobrasil.com.br` apontar para a VPS, valide:

   ```sh
   curl --fail https://crm.mibrobrasil.com.br/api/health
   ```

## Integração Shopify

Na `.env` do app Shopify na VPS, configure:

```text
CRM_API_URL=https://crm.mibrobrasil.com.br
CRM_SHOPIFY_SHARED_SECRET=<mesmo valor do CRM>
```

Depois reconstrua/reinicie somente o container do app Shopify. Nunca exponha
o segredo em logs, commits ou comandos salvos no histórico.
