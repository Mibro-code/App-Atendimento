#!/usr/bin/env bash
# Confere, SEM alterar nada, se a fonte do app Shopify em produção tem os
# símbolos usados pela ponte de propostas e se os arquivos novos ainda não
# existem lá. Uso: SRC=/opt/shopify/mibro bash check-base-exports.sh
set -Eeuo pipefail
SRC="${SRC:-/opt/shopify/mibro}"
problems=0
need() { grep -q "$2" "$SRC/$1" || { echo "FALTA em $1: $2"; problems=$((problems + 1)); }; }
for sym in olistRequest findOlistContactByTaxId createOlistContact findOlistProductBySku getOlistOrder; do
  need app/services/olist-api.server.js "export async function $sym("
done
need app/services/olist-api.server.js "export class OlistApiError"
need app/services/crm-order-bridge.server.js "export async function resolveBridgeShop("
need app/services/crm-bridge-http.server.js "export async function handleCrmBridge("
need app/services/olist-order-read-retry.server.js "export async function retryOlistOrderRead("
need app/services/wholesale-mode.server.js "export async function assertWholesaleOrderCreationAllowed("
for sym in isCompleteAddress formatTaxId taxIdPersonType isValidTaxId onlyDigits; do
  need app/services/crm-order-bridge-rules.js "export function $sym("
done
for f in app/services/crm-proposal-bridge-rules.js app/services/crm-proposal-bridge.server.js \
  app/routes/internal.crm.proposals.upsert.jsx app/routes/internal.crm.proposals.find.jsx app/routes/internal.crm.proposals.get.jsx \
  app/routes/internal.crm.proposals.situation.jsx app/routes/internal.crm.proposals.mark.jsx app/routes/internal.crm.proposals.convert.jsx \
  app/routes/internal.crm.orders.inspect.jsx app/routes/internal.crm.sellers.list.jsx; do
  [ -e "$SRC/$f" ] && { echo "JÁ EXISTE (conferir conteúdo): $f"; problems=$((problems + 1)); }
done
if [ "$problems" -ne 0 ]; then echo "ABORTAR: $problems problema(s)."; exit 2; fi
echo "BASE_OK"
