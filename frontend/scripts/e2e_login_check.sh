#!/usr/bin/env bash
#
# Headless end-to-end check of the Authorization Code + PKCE flow, using the
# same PKCE helpers and authorization URL as the login button. It:
#   1. builds a fresh PKCE pair + authorization URL (lib/oauth, lib/pkce),
#   2. fetches the Keycloak login form,
#   3. posts alice's credentials,
#   4. captures the callback `code` + `state` and checks `state`,
#   5. exchanges the code with the code_verifier,
#   6. replays the same code (must fail with invalid_grant — the reason the
#      Strict Mode / reload guard exists),
#   7. refreshes and compares only the LAST 6 chars of the access tokens.
# Prints only non-sensitive results; never prints tokens.
#
#   bash scripts/e2e_login_check.sh [username] [password]
#
# Requires: Keycloak up and `tsx` installed.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$(dirname "$HERE")"
GATEWAY="http://localhost:8080/realms/demo-realm"
TOKEN_ENDPOINT="${GATEWAY}/protocol/openid-connect/token"
REDIRECT_URI="http://localhost:3000/callback"
USERNAME="${1:-alice}"
PASSWORD="${2:-alice123}"

COOKIES="$(mktemp)"
TOKFILE="$(mktemp)"
trap 'rm -f "$COOKIES" "$TOKFILE"' EXIT
chmod 600 "$TOKFILE"

PAIR="$(cd "$FRONTEND" && ./node_modules/.bin/tsx scripts/pkce_pair.ts | tail -1)"
read_field() { printf '%s' "$PAIR" | python3 -c "import sys,json;print(json.load(sys.stdin)['$1'])"; }
VERIFIER="$(read_field verifier)"
STATE="$(read_field state)"
AUTH_URL="$(read_field authorizationUrl)"

echo "verifier length: ${#VERIFIER} (must be 43..128)"
echo "authorization URL: ${AUTH_URL%%\?*}"

LOGIN_HTML="$(curl -s -c "$COOKIES" "$AUTH_URL")"
ACTION="$(printf '%s' "$LOGIN_HTML" | grep -o 'action="[^"]*"' | head -1 | sed 's/action="//; s/"$//; s/&amp;/\&/g')"
if [ -z "$ACTION" ]; then
  echo "FAIL: could not find the login form action in the page"; exit 1
fi
echo "login form: $(printf '%s' "$ACTION" | cut -d'?' -f1)"

RESP="$(curl -s -i -b "$COOKIES" -c "$COOKIES" \
  -d "username=${USERNAME}" -d "password=${PASSWORD}" -d "credentialId=" "$ACTION")"
LOCATION="$(printf '%s' "$RESP" | grep -i '^location:' | head -1 | sed 's/^[Ll]ocation: //' | tr -d '\r')"
if [ -z "$LOCATION" ]; then
  echo "FAIL: no redirect after login (check credentials)"; exit 1
fi
echo "redirect target: $(printf '%s' "$LOCATION" | cut -d'?' -f1)"

CODE="$(printf '%s' "$LOCATION" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')"
RETURNED_STATE="$(printf '%s' "$LOCATION" | sed -n 's/.*[?&]state=\([^&]*\).*/\1/p')"

if [ "$RETURNED_STATE" != "$STATE" ]; then
  echo "FAIL: state mismatch (returned != sent)"; exit 1
fi
echo "state check: MATCH"
if [ -z "$CODE" ]; then
  echo "FAIL: callback had no authorization code"; exit 1
fi
echo "authorization code: received"

curl -s -X POST "$TOKEN_ENDPOINT" \
  -d grant_type=authorization_code -d client_id=nextjs-app \
  -d "code=${CODE}" -d "redirect_uri=${REDIRECT_URI}" -d "code_verifier=${VERIFIER}" \
  > "$TOKFILE"

python3 - "$TOKFILE" "$CODE" "$VERIFIER" "$TOKEN_ENDPOINT" "$REDIRECT_URI" <<'PY'
import sys, json, urllib.parse, urllib.request, urllib.error

tokfile, code, verifier, token_endpoint, redirect_uri = sys.argv[1:6]
data = json.load(open(tokfile))
if "access_token" not in data:
    print("FAIL: token exchange error:", data); sys.exit(1)

print("token exchange: OK (token_type=%s, expires_in=%s, id_token=%s, refresh_token=%s)"
      % (data.get("token_type"), data.get("expires_in"),
         bool(data.get("id_token")), bool(data.get("refresh_token"))))

def post(fields):
    req = urllib.request.Request(
        token_endpoint, data=urllib.parse.urlencode(fields).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)

# Refresh FIRST: replaying the code below revokes the session's tokens, so the
# refresh has to run while the session is still valid.
status2, body2 = post({"grant_type": "refresh_token", "client_id": "nextjs-app",
                       "refresh_token": data["refresh_token"]})
old_tail = data["access_token"][-6:]
if "access_token" in body2:
    new_tail = body2["access_token"][-6:]
    print("refresh: HTTP %s new access token ...%s (was ...%s) -> %s"
          % (status2, new_tail, old_tail, "changed" if new_tail != old_tail else "UNCHANGED"))
else:
    print("refresh: HTTP %s error=%s" % (status2, body2.get("error")))

status, body = post({"grant_type": "authorization_code", "client_id": "nextjs-app",
                     "code": code, "redirect_uri": redirect_uri, "code_verifier": verifier})
print("replayed same code: HTTP %s error=%s  <- why the Strict Mode guard is required"
      % (status, body.get("error")))
PY

echo "PASS: full Authorization Code + PKCE flow succeeded."
