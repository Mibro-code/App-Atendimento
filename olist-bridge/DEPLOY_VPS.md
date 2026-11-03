# Deploy da Mibro em VPS DigitalOcean

Este projeto usa Docker Compose com tr?s servi?os:

- `app`: Node.js/React Router/Shopify;
- `db`: PostgreSQL 16 sem porta p?blica;
- `caddy`: proxy reverso e HTTPS autom?tico.

## Recurso recomendado

Para a primeira loja, use um Droplet Basic de 1 vCPU, 2 GB de RAM e 50 GB SSD. Use Ubuntu 24.04 LTS na regi?o mais pr?xima da opera??o. Habilite backup semanal do Droplet e mantenha tamb?m os backups l?gicos do PostgreSQL fora da VPS.

Abra no firewall somente:

- TCP 22, limitado aos IPs administrativos sempre que poss?vel;
- TCP 80;
- TCP 443;
- UDP 443, opcional para HTTP/3.

N?o abra a porta 5432.

## 1. Definir o dom?nio definitivo

Os arquivos est?o preparados com `app.mibrobrasil.com.br`. Se outro subdom?nio for usado, altere antes do deploy:

- `APP_DOMAIN` e `SHOPIFY_APP_URL` no arquivo `.env`;
- `application_url` e `auth.redirect_urls` em `shopify.app.toml`.

Crie um registro DNS A do subdom?nio apontando para o IPv4 p?blico do Droplet. O Caddy s? conseguir? emitir o certificado depois que o DNS estiver propagado e as portas 80/443 estiverem abertas.

## 2. Preparar a VPS

Instale Docker Engine e o plugin Docker Compose pelo reposit?rio oficial do Docker. Clone o reposit?rio em um diret?rio dedicado, por exemplo `/opt/mibro-shopify`.

Na raiz do projeto:

```sh
cp .env.example .env
chmod 600 .env
```

Preencha todos os valores marcados com `SUBSTITUA`. N?o coloque aspas em volta dos valores. Se a senha do PostgreSQL contiver caracteres reservados de URL, use a vers?o percent-encoded em `DATABASE_URL`.

Os valores de `SHOPIFY_API_KEY` e `SHOPIFY_API_SECRET` v?m do app de produ??o no Shopify Dev Dashboard. O Client ID n?o ? secreto; o Client secret ?.

## 3. Primeiro deploy web

```sh
sh scripts/deploy.sh
docker compose ps
curl --fail https://app.mibrobrasil.com.br/health
```

O container executa `prisma migrate deploy` antes de iniciar o servidor. O primeiro deploy cria o schema PostgreSQL automaticamente.

Se o app n?o ficar saud?vel:

```sh
docker compose logs --tail=200 app
docker compose logs --tail=200 db
docker compose logs --tail=200 caddy
```

## 4. Configurar e publicar a vers?o Shopify

Fa?a esta etapa numa m?quina administrativa com Shopify CLI autenticado, n?o dentro do container web:

```sh
export SHOPIFY_APP_URL=https://app.mibrobrasil.com.br
npm ci
npm run lint
npm run typecheck
npm run build
npm run build:shopify
npm run deploy
```

O script gera os dois m?dulos `app-url.js` usados pelas Customer Account UI Extensions. Confirme no diff que eles cont?m exatamente o mesmo origin de `SHOPIFY_APP_URL`.

URLs configuradas:

- App URL: `https://app.mibrobrasil.com.br`;
- OAuth: `https://app.mibrobrasil.com.br/auth/callback`;
- webhook app/uninstalled: `https://app.mibrobrasil.com.br/webhooks/app/uninstalled`;
- webhook app/scopes_update: `https://app.mibrobrasil.com.br/webhooks/app/scopes_update`;
- webhook orders/paid: `https://app.mibrobrasil.com.br/webhooks/orders/paid`.

N?o h? App Proxy neste projeto.

Depois do deploy da vers?o, selecione Custom distribution para o app de produ??o, vincule a loja Mibro, gere o link e instale. N?o fa?a a instala??o antes de o healthcheck HTTPS responder com status 200.

## 5. Backup

Crie um backup manual antes de cada atualiza??o:

```sh
BACKUP_DIR=/var/backups/mibro sh scripts/backup.sh
```

Agende o mesmo comando diariamente com cron e copie os arquivos criptografados para outro provedor ou para um bucket privado. Backup armazenado somente na mesma VPS n?o protege contra perda do Droplet.

Teste periodicamente a restaura??o em outro banco. Uma restaura??o sobrescreve dados e deve ser feita apenas em procedimento controlado de recupera??o.

## 6. Atualiza??es

```sh
cd /opt/mibro-shopify
BACKUP_DIR=/var/backups/mibro sh scripts/backup.sh
git pull --ff-only
sh scripts/deploy.sh
curl --fail https://app.mibrobrasil.com.br/health
```

Publique uma nova vers?o Shopify somente quando houver mudan?a em `shopify.app.toml` ou nas extens?es. Mudan?as apenas no backend exigem somente o deploy Docker.

## 7. Monitoramento

Monitore:

- `https://app.mibrobrasil.com.br/health` a cada minuto com um monitor externo;
- status e rein?cios dos containers;
- uso de RAM, disco e CPU do Droplet;
- espa?o do volume Docker;
- respostas 500 dos webhooks;
- falhas ao criar descontos;
- validade dos backups.

Configure alertas de CPU, mem?ria, disco e disponibilidade no painel da DigitalOcean. Nunca envie tokens, e-mails, payloads completos de pedidos ou c?digos de recompensa aos logs.

## 8. Sincrofit no mesmo Droplet

? poss?vel, mas n?o reutilize o mesmo processo quando a Sincrofit tiver outro Client ID/secret Shopify. Crie:

- segundo servi?o de app;
- segundo arquivo de ambiente;
- segundo banco e usu?rio PostgreSQL;
- segundo subdom?nio;
- segundo bloco no Caddyfile.

O Caddy pode continuar ?nico nas portas 80/443. Mibro e Sincrofit devem ter credenciais, sess?es, bancos e backups separados. Para duas instala??es ativas, aumente o Droplet para pelo menos 2 vCPUs e 4 GB de RAM.
