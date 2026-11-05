#!/usr/bin/env bash
#
# scripts/get_token.sh — fetch an access (or refresh) token from Keycloak.
#
# DEV / TESTING ONLY. This uses the OAuth 2.0 Resource Owner Password
# Credentials grant against the public `cli-test` client, which must have
# Direct Access Grants enabled. The real applications do NOT use this grant:
# the Next.js frontend uses Authorization Code + PKCE in the browser. This
# script exists only so tests and command-line checks can obtain a token
# without a browser, so keep `cli-test` enabled only in dev/test realms.
#
# Usage:
#   scripts/get_token.sh <username> <password>
#   scripts/get_token.sh <username> <password> --refresh
#
# Environment overrides:
#   KEYCLOAK_URL  (default http://localhost:8080)
#   REALM         (default demo-realm)
#   CLIENT_ID     (default cli-test)

set -euo pipefail

KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8080}"
REALM="${REALM:-demo-realm}"
CLIENT_ID="${CLIENT_ID:-cli-test}"

usage() {
  echo "usage: $0 <username> <password> [--refresh]" >&2
  exit 2
}

if [ "$#" -lt 2 ]; then
  usage
fi

USERNAME="$1"
PASSWORD="$2"
MODE="${3:-}"

RESPONSE="$(curl -sS -X POST \
  "${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token" \
  -d "grant_type=password" \
  -d "client_id=${CLIENT_ID}" \
  -d "username=${USERNAME}" \
  -d "password=${PASSWORD}")"

printf '%s' "${RESPONSE}" | python3 -c '
import sys, json
mode = sys.argv[1]
try:
    data = json.load(sys.stdin)
except json.JSONDecodeError:
    sys.stderr.write("Could not parse Keycloak response as JSON.\n")
    sys.exit(1)
if "error" in data:
    sys.stderr.write("Keycloak error: %s (%s)\n" % (
        data.get("error"), data.get("error_description", "no description")))
    sys.exit(1)
key = "refresh_token" if mode == "--refresh" else "access_token"
token = data.get(key)
if not token:
    sys.stderr.write("Response did not contain %s\n" % key)
    sys.exit(1)
print(token)
' "${MODE}"
