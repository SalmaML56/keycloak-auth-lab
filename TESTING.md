# TESTING.md

Two kinds of tests live here:

1. **Automated checks** the agent (or CI) can run — real command output is in
   `CHECKLIST.md` Phase 3.
2. A **manual browser script** — these steps need a real browser, so they are
   marked **NOT VERIFIED by agent, manual**. The protocol-level equivalent
   (`frontend/scripts/e2e_login_check.sh`) does exercise the same login,
   exchange, refresh and replay steps headlessly, but it cannot check the UI.

---

## 1. Automated checks

```bash
# Backend (from backend/, venv active)
./.venv/bin/pip install -r requirements.txt
./.venv/bin/python ../scripts/check_route_protection.py     # routes are protected

# Frontend (from frontend/)
npm run build            # F13: production build, zero TS errors
npm run lint             # F14: eslint, zero warnings/errors
npm run test:pkce        # F1 : RFC 7636 test vector passes
npm run check:auth-url   # login URL accepted by Keycloak (200/302, no error page)
bash scripts/e2e_login_check.sh   # full code exchange + refresh + replay guard
```

Prerequisites for anything touching Keycloak: `keycloak/` up and healthy
(`docker compose -f keycloak/docker-compose.yml up -d`).

---

## 2. Manual browser test script — **NOT VERIFIED by agent, manual**

Start everything first:

```bash
docker compose -f keycloak/docker-compose.yml up -d          # Keycloak on :8080
cd backend  && ./.venv/bin/uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev                                   # Next.js on :3000
```

Then, in a browser (use a private window so no old session is reused):

| # | Step | Expected | Type |
|---|------|----------|------|
| 1 | Open `http://localhost:3000/` | "Not logged in." + **Login with Keycloak** button | NOT VERIFIED by agent, manual |
| 2 | Click **Login with Keycloak** | Browser navigates to the Keycloak login page. URL contains `client_id=nextjs-app`, `redirect_uri=…%2Fcallback`, `code_challenge=…`, `code_challenge_method=S256`, `state=…` | NOT VERIFIED by agent, manual |
| 3 | Log in as `alice` / `alice123` | Redirected to `/callback`, then to `/` showing "Logged in." | NOT VERIFIED by agent, manual |
| 4 | Watch the **Session** box | Countdown "Access token expires in: 60s" ticking down each second | NOT VERIFIED by agent, manual |
| 5 | Expand the **Tokens** section | Access / ID / refresh tokens decoded into header + payload. Access token payload has `"aud":"fastapi-api"` and `realm_access.roles` containing `"user"`. A note says decoding is **NOT** verification | NOT VERIFIED by agent, manual |
| 6 | Click **Call /public** | Status shown green **200**, body `{"message":"This route is public.",…}` | NOT VERIFIED by agent, manual |
| 7 | Click **Call /profile** | Green **200**, body shows `"username":"alice"` | NOT VERIFIED by agent, manual |
| 8 | Click **Call /admin** | Orange **403**, body `{"detail":"Requires role: admin"}` (alice is not an admin) | NOT VERIFIED by agent, manual |
| 9 | Wait until the countdown reaches **0** | The box shows **expired** in red | NOT VERIFIED by agent, manual |
| 10 | Click **Call /profile** again | Red **401**, body `{"detail":"Token expired"}` — the button stays enabled on purpose | NOT VERIFIED by agent, manual |
| 11 | Click **Refresh token** | Message: `Refreshed. access token …abc123 → …def456 (changed…)` — only the last 6 characters are shown | NOT VERIFIED by agent, manual |
| 12 | Click **Call /profile** again | Green **200** again (a fresh token was obtained) | NOT VERIFIED by agent, manual |
| 13 | Click **Logout** | Browser goes to Keycloak's logout page, then back to `http://localhost:3000/` | NOT VERIFIED by agent, manual |
| 14 | After logout | Home shows "Not logged in." and the **Tokens** section is gone | NOT VERIFIED by agent, manual |

### Edge cases to try (all **NOT VERIFIED by agent, manual**)

- **Strict Mode single exchange** — with `npm run dev`, open DevTools → Network.
  On returning to `/callback` there is exactly **one** POST to the token
  endpoint (the ref + `sessionStorage` guard suppresses the Strict Mode
  double-run). A second POST would fail with `invalid_grant`.
- **State mismatch** — visit
  `http://localhost:3000/callback?code=fake&state=wrong`
  → red error "State mismatch — the callback does not match the login attempt
  that started it."
- **Missing state** — `http://localhost:3000/callback?code=fake`
  → error "Callback is missing the 'state' parameter".
- **Replayed / duplicate callback** — reload `/callback` after a successful
  login → "This authorization code was already exchanged … Start a new login."
- **invalid_grant on refresh** — log in, click **Logout** in another tab (or
  wait out the SSO idle timeout), then click **Refresh token** → message
  "Refresh failed: … Tokens cleared — please log in again." and the UI returns
  to "Not logged in."
- **bob is admin** — log in as `bob` / `bob123`, click **Call /admin** →
  green **200** `{"message":"Welcome, admin.","username":"bob",…}`.

---

## 3. Automated test suite — cases a–k

All of this is automated by `scripts/run_tests.sh` (it starts nothing; it
requires Keycloak on 8080 and the backend on 8000). Run it with:

```bash
scripts/run_tests.sh          # full run (case c waits 75s)
scripts/run_tests.sh --fast   # skip case c
```

Below is the manual equivalent of each case, with the **real status codes**
captured from the last full run (`PASS=14 FAIL=0 SKIP=0`).

Common setup (never prints the token):

```bash
export KEYCLOAK_URL=http://localhost:8080
export API_URL=http://localhost:8000
export REALM_URL=$KEYCLOAK_URL/realms/demo-realm
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
TOKEN=$(scripts/get_token.sh alice alice123)
```

| Case | Command | Expected | Real result |
|------|---------|----------|-------------|
| a | `status -H "Authorization: Bearer $TOKEN" $API_URL/profile` | `200` | `200` ✅ |
| b | `status $API_URL/profile` | `401` | `401` ✅ |
| c | get a fresh `$TOKEN`, then `sleep 75` (60s lifetime + 10s leeway), then `status -H "Authorization: Bearer $TOKEN" $API_URL/profile` | `401` | `401` ✅ (after countdown 75→15s) |
| d | `TAMPERED=$(python3 scripts/make_bad_tokens.py tamper "$TOKEN"); status -H "Authorization: Bearer $TAMPERED" $API_URL/profile` | `401` | `401` ✅ |
| e | `NONE=$(python3 scripts/make_bad_tokens.py none); status -H "Authorization: Bearer $NONE" $API_URL/profile` | `401` | `401` ✅ |
| f | `WRONG=$(bash scripts/wrong_aud_token.sh alice alice123); status -H "Authorization: Bearer $WRONG" $API_URL/profile` | `401` | `401` ✅ |
| g | `ALICE=$(scripts/get_token.sh alice alice123); BOB=$(scripts/get_token.sh bob bob123)` then `status -H "Authorization: Bearer $ALICE" $API_URL/admin` and `status -H "Authorization: Bearer $BOB" $API_URL/admin` | `403` / `200` | `403` ✅ / `200` ✅ |
| h | `curl -s -X POST $REALM_URL/protocol/openid-connect/token -d grant_type=refresh_token -d client_id=cli-test -d refresh_token=$REFRESH` — compare `…${ACCESS: -6}` with `…${NEW_ACCESS: -6}` | new token | `...ipOrwA -> ...JTaWKA` (changed) ✅ |
| i | `status -X POST $REALM_URL/protocol/openid-connect/logout -d client_id=cli-test -d refresh_token=$REFRESH` then repeat the refresh call and read `.error` | `204`, then `invalid_grant` | `204` ✅, `invalid_grant` ✅ |
| j | fresh token: `curl -s -X POST $API_URL/introspect-demo -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"token\":\"$TOKEN\"}"` → `.active`; then after logout, same call authenticated with another user's token → `.active` | `true` / `false` | `true` ✅ / `false` ✅ |
| k | after logout, `status -H "Authorization: Bearer $ACCESS_AFTER_LOGOUT" $API_URL/profile` | `200` (limitation demonstrated) | `200` ✅ |

Case k in plain English: **a token revoked in Keycloak is still accepted by the
backend until it expires, because the backend verifies tokens offline (it
checks the signature and claims in the JWT) and never asks Keycloak whether the
session is still alive.** Use a short access-token lifetime, and call
introspection for sensitive actions, to reduce that window.

Full-suite output is recorded in `CHECKLIST.md` (T2).
