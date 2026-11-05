#!/usr/bin/env bash
#
# DEV/TESTING ONLY.
#
# Mint a Keycloak-SIGNED access token whose `aud` is intentionally wrong, so
# the backend's "wrong audience" rejection can be shown with a genuinely
# signed token rather than a hand-forged one.
#
# It temporarily creates a throwaway public client with an audience mapper
# pointing at $WRONG_AUD, requests a password-grant token for that client,
# then deletes the client again. Prints ONLY the access token on stdout.
#
# Usage:
#   scripts/wrong_aud_token.sh [username] [password]
#
# Environment overrides: KEYCLOAK_URL, REALM, WRONG_AUD

set -euo pipefail

USERNAME="${1:-alice}"
PASSWORD="${2:-alice123}"
KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8080}"
REALM="${REALM:-demo-realm}"
WRONG_AUD="${WRONG_AUD:-wrong-api}"
KCADM=/opt/keycloak/bin/kcadm.sh

docker exec keycloak "$KCADM" config credentials \
  --server http://localhost:8080 --realm master --user admin --password admin >/dev/null

CID=""
cleanup() {
  if [ -n "$CID" ]; then
    docker exec keycloak "$KCADM" delete clients/"$CID" -r "$REALM" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

OUT="$(docker exec keycloak "$KCADM" create clients -r "$REALM" \
  -s clientId=aud-probe -s enabled=true -s publicClient=true \
  -s directAccessGrantsEnabled=true -s standardFlowEnabled=false \
  -s implicitFlowEnabled=false 2>&1)"
CID="$(printf '%s' "$OUT" | sed -n "s/.*id '\([^']*\)'.*/\1/p")"

MAPPER_FILE="$(mktemp)"
cat > "$MAPPER_FILE" <<JSON
{
  "name": "wrong-aud",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-audience-mapper",
  "consentRequired": false,
  "config": {
    "included.client.audience": "$WRONG_AUD",
    "access.token.claim": "true",
    "id.token.claim": "false"
  }
}
JSON
docker cp "$MAPPER_FILE" keycloak:/tmp/wrong_aud_mapper.json >/dev/null
rm -f "$MAPPER_FILE"
docker exec keycloak "$KCADM" create clients/"$CID"/protocol-mappers/models \
  -r "$REALM" -f /tmp/wrong_aud_mapper.json >/dev/null

RESPONSE="$(curl -sS -X POST \
  "${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token" \
  -d "grant_type=password" -d "client_id=aud-probe" \
  -d "username=${USERNAME}" -d "password=${PASSWORD}")"

printf '%s' "$RESPONSE" | python3 -c '
import sys, json
data = json.load(sys.stdin)
if "access_token" not in data:
    sys.stderr.write("Keycloak did not return a token: %s\n" % data)
    sys.exit(1)
print(data["access_token"])
'
