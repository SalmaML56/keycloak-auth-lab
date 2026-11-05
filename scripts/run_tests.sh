#!/usr/bin/env bash
#
# scripts/run_tests.sh — end-to-end test suite for the Keycloak auth lab.
#
# This script starts NOTHING. It first checks that Keycloak (8080) and the
# backend (8000) are already running and exits with a clear message if not.
# It then runs cases a..k, prints PASS/FAIL per case and a final summary, and
# exits non-zero if any case failed.
#
# It NEVER prints tokens — only HTTP status codes, booleans and the last 6
# characters of an access token (for the refresh comparison).
#
# Usage:
#   scripts/run_tests.sh            # full run (case c waits 75s)
#   scripts/run_tests.sh --fast     # skip case c

set -uo pipefail

KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8080}"
API_URL="${API_URL:-http://localhost:8000}"
REALM="${REALM:-demo-realm}"
CLIENT_ID="${CLIENT_ID:-cli-test}"
REALM_URL="$KEYCLOAK_URL/realms/$REALM"
TOKEN_ENDPOINT="$REALM_URL/protocol/openid-connect/token"
LOGOUT_ENDPOINT="$REALM_URL/protocol/openid-connect/logout"

FAST=0
for arg in "$@"; do
  case "$arg" in
    --fast) FAST=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/scripts"
TOKDIR="$(mktemp -d)"
trap 'rm -rf "$TOKDIR"' EXIT

PASS=0; FAIL=0; SKIP=0
pass() { printf 'PASS  %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf 'FAIL  %s\n' "$1"; FAIL=$((FAIL + 1)); }
skip() { printf 'SKIP  %s\n' "$1"; SKIP=$((SKIP + 1)); }
check() { # name expected actual
  if [ "$2" = "$3" ]; then pass "$1 (expected $2)"; else fail "$1 (expected $2, got $3)"; fi
}

status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
body()   { curl -s "$@"; }
jfield() { python3 -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: d={}
print(d.get(sys.argv[1]) if d.get(sys.argv[1]) is not None else "")' "$1"; }
# json value from a file saved by fetch_tokens
ffile() { python3 -c 'import sys,json;d=json.load(open(sys.argv[1]));print(d.get(sys.argv[2],"") or "")' "$1" "$2"; }

fetch_tokens() { # username password outfile
  curl -s -X POST "$TOKEN_ENDPOINT" \
    -d grant_type=password -d "client_id=$CLIENT_ID" \
    -d "username=$1" -d "password=$2" > "$3"
  chmod 600 "$3"
}

# --------------------------------------------------------------------------
echo "== preflight: services already running? =="
well_known=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$REALM_URL/.well-known/openid-configuration")
if [ "$well_known" != "200" ]; then
  echo "ERROR: Keycloak is not reachable at $KEYCLOAK_URL (well-known HTTP $well_known)."
  echo "       Start it first: docker compose -f keycloak/docker-compose.yml up -d"
  exit 2
fi
api_health=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$API_URL/health")
if [ "$api_health" != "200" ]; then
  echo "ERROR: backend is not reachable at $API_URL (health HTTP $api_health)."
  echo "       Start it first: cd backend && ./.venv/bin/uvicorn app.main:app --port 8000"
  exit 2
fi
echo "Keycloak: OK ($KEYCLOAK_URL)   Backend: OK ($API_URL)"
echo

# --------------------------------------------------------------------------
echo "== a: valid access token -> 200 =="
TOKEN="$("$SCRIPTS/get_token.sh" alice alice123)"
check "a valid token /profile" 200 "$(status -H "Authorization: Bearer $TOKEN" "$API_URL/profile")"

echo "== b: no token -> 401 =="
check "b no token /profile" 401 "$(status "$API_URL/profile")"

echo "== c: expired token -> 401 =="
if [ "$FAST" = 1 ]; then
  skip "c expired token (--fast)"
else
  EXPIRED_TOKEN="$("$SCRIPTS/get_token.sh" alice alice123)"
  echo "   waiting 75s (60s lifetime + 10s leeway) for the token to expire..."
  for remaining in 75 60 45 30 15; do
    printf '   %2ds remaining\n' "$remaining"
    sleep 15
  done
  check "c expired token /profile" 401 "$(status -H "Authorization: Bearer $EXPIRED_TOKEN" "$API_URL/profile")"
fi

echo "== d: tampered payload -> 401 =="
REAL="$("$SCRIPTS/get_token.sh" alice alice123)"
TAMPERED="$(python3 "$SCRIPTS/make_bad_tokens.py" tamper "$REAL")"
check "d tampered payload /profile" 401 "$(status -H "Authorization: Bearer $TAMPERED" "$API_URL/profile")"

echo "== e: alg=none -> 401 =="
NONE_TOKEN="$(python3 "$SCRIPTS/make_bad_tokens.py" none)"
check "e alg=none /profile" 401 "$(status -H "Authorization: Bearer $NONE_TOKEN" "$API_URL/profile")"

echo "== f: wrong audience -> 401 =="
WRONG_AUD="$(bash "$SCRIPTS/wrong_aud_token.sh" alice alice123)"
check "f wrong audience /profile" 401 "$(status -H "Authorization: Bearer $WRONG_AUD" "$API_URL/profile")"

echo "== g: role enforcement =="
ALICE="$("$SCRIPTS/get_token.sh" alice alice123)"
BOB="$("$SCRIPTS/get_token.sh" bob bob123)"
check "g alice /admin (role: user)" 403 "$(status -H "Authorization: Bearer $ALICE" "$API_URL/admin")"
check "g bob /admin (role: admin)" 200 "$(status -H "Authorization: Bearer $BOB" "$API_URL/admin")"

echo "== h: refresh returns a new access token =="
fetch_tokens alice alice123 "$TOKDIR/h.json"
H_ACC="$(ffile "$TOKDIR/h.json" access_token)"
H_REF="$(ffile "$TOKDIR/h.json" refresh_token)"
H_NEW="$(curl -s -X POST "$TOKEN_ENDPOINT" -d grant_type=refresh_token \
  -d "client_id=$CLIENT_ID" -d "refresh_token=$H_REF" | jfield access_token)"
H_OLD_TAIL="${H_ACC: -6}"
H_NEW_TAIL="${H_NEW: -6}"
if [ -n "$H_NEW" ] && [ "$H_OLD_TAIL" != "$H_NEW_TAIL" ]; then
  pass "h refresh gave a new access token (...$H_OLD_TAIL -> ...$H_NEW_TAIL)"
else
  fail "h refresh did not change the access token (old ...$H_OLD_TAIL, new ...$H_NEW_TAIL)"
fi

echo "== i/j/k: logout, introspection and the offline-verification limit =="
fetch_tokens alice alice123 "$TOKDIR/ijk.json"
IJK_ACC="$(ffile "$TOKDIR/ijk.json" access_token)"
IJK_REF="$(ffile "$TOKDIR/ijk.json" refresh_token)"

# j (part 1): a fresh token introspects as active.
INTROSPECT_BODY="$(TOKEN="$IJK_ACC" python3 -c 'import os,json;print(json.dumps({"token":os.environ["TOKEN"]}))')"
ACTIVE_FRESH="$(body -X POST "$API_URL/introspect-demo" \
  -H "Authorization: Bearer $IJK_ACC" -H 'Content-Type: application/json' \
  -d "$INTROSPECT_BODY" | jfield active)"
check "j introspection of a fresh token -> active=true" "True" "$ACTIVE_FRESH"

# i: revoke the session at the logout endpoint using the refresh token.
LOGOUT_CODE="$(status -X POST "$LOGOUT_ENDPOINT" -d "client_id=$CLIENT_ID" -d "refresh_token=$IJK_REF")"
check "i logout endpoint accepts refresh_token" 204 "$LOGOUT_CODE"

# i: the refresh token must now be dead.
REFRESH_ERR="$(curl -s -X POST "$TOKEN_ENDPOINT" -d grant_type=refresh_token \
  -d "client_id=$CLIENT_ID" -d "refresh_token=$IJK_REF" | jfield error)"
check "i refresh after logout -> invalid_grant" invalid_grant "$REFRESH_ERR"

# j (part 2): the revoked token introspects as inactive (auth with another session).
BOB2="$("$SCRIPTS/get_token.sh" bob bob123)"
INTROSPECT_BODY2="$(TOKEN="$IJK_ACC" python3 -c 'import os,json;print(json.dumps({"token":os.environ["TOKEN"]}))')"
ACTIVE_REVOKED="$(body -X POST "$API_URL/introspect-demo" \
  -H "Authorization: Bearer $BOB2" -H 'Content-Type: application/json' \
  -d "$INTROSPECT_BODY2" | jfield active)"
check "j introspection of a logged-out token -> active=false" "False" "$ACTIVE_REVOKED"

# k: the backend still accepts the revoked token (offline JWT verification).
check "k known limitation demonstrated: revoked token still accepted by backend" 200 \
  "$(status -H "Authorization: Bearer $IJK_ACC" "$API_URL/profile")"
echo "   Why: the backend verifies the JWT offline (signature + claims), so a"
echo "   session revoked in Keycloak is not noticed until the token expires."

# --------------------------------------------------------------------------
echo
echo "== summary =="
printf 'PASS=%d  FAIL=%d  SKIP=%d\n' "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -gt 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS"
exit 0
