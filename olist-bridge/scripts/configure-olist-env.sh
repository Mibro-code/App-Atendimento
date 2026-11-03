#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
env_file=${ENV_FILE:-"$project_dir/.env"}
tmp_file=
terminal_echo_disabled=false

cleanup() {
  if [ "$terminal_echo_disabled" = true ]; then
    stty echo 2>/dev/null || true
  fi

  if [ -n "$tmp_file" ] && [ -f "$tmp_file" ]; then
    rm -f -- "$tmp_file"
  fi
}

trap cleanup EXIT HUP INT TERM

if [ ! -f "$env_file" ]; then
  echo "Arquivo .env nao encontrado em: $env_file" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl nao esta instalado." >&2
  exit 1
fi

app_url=$(
  sed -n 's/^SHOPIFY_APP_URL=//p' "$env_file" | tail -n 1 | tr -d '\r'
)

case "$app_url" in
  https://*)
    app_url=${app_url%/}
    ;;
  *)
    echo "SHOPIFY_APP_URL precisa estar configurada com HTTPS em: $env_file" >&2
    exit 1
    ;;
esac

printf "Client ID do aplicativo Olist: "
IFS= read -r olist_client_id

printf "Client Secret do aplicativo Olist (entrada oculta): "
if [ -t 0 ]; then
  stty -echo
  terminal_echo_disabled=true
fi
IFS= read -r olist_client_secret
if [ "$terminal_echo_disabled" = true ]; then
  stty echo
  terminal_echo_disabled=false
fi
printf "\n"

if [ -z "$olist_client_id" ] || [ -z "$olist_client_secret" ]; then
  echo "Client ID e Client Secret sao obrigatorios." >&2
  exit 1
fi

case "$olist_client_id$olist_client_secret" in
  *'
'*)
    echo "As credenciais nao podem conter quebra de linha." >&2
    exit 1
    ;;
esac

existing_encryption_key=$(
  sed -n 's/^OLIST_TOKEN_ENCRYPTION_KEY=//p' "$env_file" | tail -n 1
)

case "$existing_encryption_key" in
  ""|SUBSTITUA*)
    olist_encryption_key=$(openssl rand -base64 32)
    ;;
  *)
    olist_encryption_key=$existing_encryption_key
    ;;
esac

umask 077
tmp_file=$(mktemp "${env_file}.tmp.XXXXXX")

awk '
  BEGIN {
    skip["OLIST_CLIENT_ID"] = 1
    skip["OLIST_CLIENT_SECRET"] = 1
    skip["OLIST_REDIRECT_URI"] = 1
    skip["OLIST_TOKEN_ENCRYPTION_KEY"] = 1
    skip["OLIST_API_BASE_URL"] = 1
    skip["OLIST_AUTHORIZATION_URL"] = 1
    skip["OLIST_TOKEN_URL"] = 1
  }
  {
    key = $0
    sub(/=.*/, "", key)
    if (key in skip) {
      next
    }
    print
  }
' "$env_file" > "$tmp_file"

{
  printf "\n"
  printf "# Integracao OAuth 2 com o ERP Olist v3.\n"
  printf "OLIST_CLIENT_ID=%s\n" "$olist_client_id"
  printf "OLIST_CLIENT_SECRET=%s\n" "$olist_client_secret"
  printf "OLIST_REDIRECT_URI=%s\n" \
    "$app_url/auth/olist/callback"
  printf "OLIST_TOKEN_ENCRYPTION_KEY=%s\n" "$olist_encryption_key"
  printf "OLIST_API_BASE_URL=%s\n" \
    "https://api.tiny.com.br/public-api/v3"
  printf "OLIST_AUTHORIZATION_URL=%s\n" \
    "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth"
  printf "OLIST_TOKEN_URL=%s\n" \
    "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token"
} >> "$tmp_file"

chmod 600 "$tmp_file"
mv -f -- "$tmp_file" "$env_file"
tmp_file=

unset olist_client_id
unset olist_client_secret
unset olist_encryption_key
unset existing_encryption_key
unset app_url

echo "Variaveis Olist configuradas com seguranca em: $env_file"
echo "Nenhum valor secreto foi exibido."
