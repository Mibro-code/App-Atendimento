# Implantação na VPS Mibro

Este projeto deve ser executado como um Compose separado em `/opt/atendimento/mibro`.
Ele usa banco e volumes próprios, não publica portas no host e entra na rede externa
`shopify-proxy`. O Caddy já existente em `/opt/shopify/mibro` continua sendo o único
responsável pelas portas 80 e 443.

## Pré-requisitos

- DNS do subdomínio apontando para o IP público da VPS.
- Rede Docker externa `shopify-proxy` já existente.
- Arquivo `.env` criado diretamente na VPS a partir de `.env.vps.example`.
- Nunca versionar, imprimir ou copiar o conteúdo de `.env` para logs.

## Rota do Caddy

Adicionar ao `Caddyfile` existente:

```caddy
atendimento.mibrobrasil.com.br {
  encode zstd gzip

  reverse_proxy atendimento-app:3000

  import security_headers
}
```

Validar o arquivo antes de recarregar o proxy:

```bash
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

## Primeira implantação

```bash
sudo mkdir -p /opt/atendimento
sudo chown deploy:deploy /opt/atendimento
git clone https://github.com/Mibro-code/App-Atendimento.git /opt/atendimento/mibro
cd /opt/atendimento/mibro
cp .env.vps.example .env
chmod 600 .env
# Preencher os segredos sem exibi-los no terminal ou no histórico.
docker compose --env-file .env -f compose.vps.yml config --quiet
docker compose --env-file .env -f compose.vps.yml build
docker compose --env-file .env -f compose.vps.yml up -d
docker compose --env-file .env -f compose.vps.yml ps
```

O processo de inicialização executa `prisma migrate deploy` antes de iniciar o servidor.

## Verificação

```bash
docker compose --env-file .env -f compose.vps.yml ps
docker compose --env-file .env -f compose.vps.yml logs --tail=100 app
curl --fail https://atendimento.mibrobrasil.com.br/health
```

Após o primeiro acesso, criar o único usuário pela tela de configuração inicial.
Depois, atualizar na Meta a URL pública do webhook, mantendo o mesmo `VERIFY_TOKEN`.

## Atualização

```bash
cd /opt/atendimento/mibro
git pull --ff-only
docker compose --env-file .env -f compose.vps.yml config --quiet
docker compose --env-file .env -f compose.vps.yml build
docker compose --env-file .env -f compose.vps.yml up -d --remove-orphans
docker compose --env-file .env -f compose.vps.yml ps
```

Não executar `docker compose down -v`: a opção `-v` remove o banco persistente.
