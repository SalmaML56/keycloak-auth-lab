# CHECKLIST.md

Legend: status is `TODO`, `PARTIAL`, `FAIL`, or `PASS`.
A row is only marked `PASS` when the **evidence** column contains real
command output that I actually ran.

---

## PHASE 1 — Keycloak (K1–K9)

| ID | Requirement | How verified | Evidence | Status |
|----|-------------|--------------|----------|--------|
| K1 | `keycloak/docker-compose.yml`: image `quay.io/keycloak/keycloak:26.0`, `start-dev --import-realm`, port 8080, admin/admin, realm mounted to `/opt/keycloak/data/import/`, healthcheck | `docker compose up`, `docker compose ps`, `docker inspect` health | `docker compose ps` → `Up About a minute (healthy)`; `docker inspect ...Health.Status` → `healthy streak=0`. **Fix applied:** healthcheck probes mgmt port 9000 but it was closed (`/dev/tcp/127.0.0.1/9000 → Connection refused`); added `KC_HEALTH_ENABLED: "true"` to compose (was 57-failure unhealthy before). | PASS |
| K2 | Realm `demo-realm` imported cleanly from `realm-export.json` | `docker compose logs` shows import; well-known URL returns JSON | `docker compose logs` → `Realm 'demo-realm' imported` / `Import finished successfully`; `curl .../realms/demo-realm/.well-known/openid-configuration` → `HTTP 200` with JSON (`"issuer":"http://localhost:8080/realms/demo-realm"`, token/auth endpoints). | PASS |
| K3 | Public client `nextjs-app`: standard flow ON, implicit OFF, direct access grants OFF, PKCE S256, redirect `http://localhost:3000/callback`, web origin `http://localhost:3000`, post-logout redirect `http://localhost:3000` | `docker compose exec … kcadm get` + `get` client JSON | `kcadm get clients -q clientId=nextjs-app` → `publicClient:true, standardFlowEnabled:true, implicitFlowEnabled:false, directAccessGrantsEnabled:false, redirectUris:["http://localhost:3000/callback"], webOrigins:["http://localhost:3000"], attributes:{"pkce.code.challenge.method":"S256","post.logout.redirect.uris":"http://localhost:3000"}`. | PASS |
| K4 | Confidential client `fastapi-api` with known secret (for introspection) | client JSON from kcadm | `kcadm get clients -q clientId=fastapi-api` → `publicClient:false, secret:"fastapi-api-secret", standardFlowEnabled:false, directAccessGrantsEnabled:false`. | PASS |
| K5 | Realm roles `user`, `admin` | kcadm get roles | `kcadm get roles -r demo-realm` → includes `"name":"admin"` ("Administrator - can access /admin") and `"name":"user"` ("Normal user of the application"). | PASS |
| K6 | Users `alice` (user), `bob` (user+admin); email/first/last set, `emailVerified=true`, no required actions, non-temporary passwords | kcadm get user JSON | `kcadm get users` → alice/bob `emailVerified:true, requiredActions:[], firstName/lastName/email set`; `kcadm get-roles --uusername alice --effective` → `['user']`, bob → `['admin','user']`; alice password login via cli-test returned a token (no `update_password` required action) ⇒ non-temporary. | PASS |
| K7 | Access token lifespan 60s; SSO defaults kept; refresh lifetime documented | realm JSON + decoded token `exp`-`iat` | `kcadm get realms/demo-realm` → `accessTokenLifespan:60, ssoSessionIdleTimeout:1800, ssoSessionMaxLifespan:36000`; decoded access token → `exp-iat = 60`; token response → `expires_in:60, refresh_expires_in:1800` (refresh bounded by SSO idle 1800s / max 36000s). | PASS |
| K8 | Audience mapper on `nextjs-app` → `aud` contains `fastapi-api`; `realm_access.roles` present | decoded token | decoded alice access token → `aud:"fastapi-api"`, `realm_access:{"roles":["user"]}`; client `nextjs-app` carries `protocolMapper: oidc-audience-mapper` (`included.client.audience=fastapi-api, access.token.claim=true`). | PASS |
| K9 | Client `cli-test` direct access grants ON (dev only), tokens have `aud=fastapi-api` + roles, `iss` exact | `scripts/get_token.sh alice`, decoded token | `kcadm get clients -q clientId=cli-test` → `directAccessGrantsEnabled:true, publicClient:true, standardFlowEnabled:false`; token via password grant → header `alg:RS256`, `aud:"fastapi-api"`, `realm_access.roles:["user"]`, `iss:"http://localhost:8080/realms/demo-realm"` exact. **Note:** originally proven with an equivalent `curl` password-grant call; the `scripts/get_token.sh` script now exists and was run (see G4). | PASS |

## PHASE 1 GAP-FIX (G1–G6)

| ID | Requirement | How verified | Evidence | Status |
|----|-------------|--------------|----------|--------|
| G1 | JWKS endpoint lists signing key; `kid` of an alice token header matches a JWKS `kid` | `curl .../protocol/openid-connect/certs` + decode token header | `certs` → `{'kid':'mbE7nBN_Og6jwiz6ZQIF2ixHDQ7dHZkaLA87ni78rjw','alg':'RS256','use':'sig','kty':'RSA'}` and `{'kid':'1SHnJzP3ktkkzAR3Wms_TUJp4r0tkUxq_neZd1Hao0s','alg':'RSA-OAEP','use':'enc','kty':'RSA'}`; token header `kid` = `mbE7nBN_…78rjw` → `MATCH = True` (after G5 fresh import; pre-import kids were `xKYIYCwX…`/`0qpK2n2k…`, also matched). | PASS |
| G2 | Admin console responds; `admin/admin` can get a master-realm admin token | `curl -w` status only (token never printed) | `/admin/` → `HTTP 302` (redirect to login); master admin token request → `HTTP 200`. | PASS |
| G3 | `nextjs-app` post logout redirect URI `http://localhost:3000` present; redirect list + web origins still match K3 | Keycloak admin API `kcadm get clients` | `post.logout.redirect.uris = 'http://localhost:3000'` **(already present — no fix needed)**; `redirectUris = ['http://localhost:3000/callback']`, `webOrigins = ['http://localhost:3000']` → still match K3. No re-import performed. | PASS |
| G4 | `scripts/get_token.sh <user> <password>` prints access token; `--refresh` prints refresh token; dev-only comment; run for alice & bob with decoded `iss/aud/exp/azp/sid/realm_access.roles` | run script + decode | alice → `iss=http://localhost:8080/realms/demo-realm, aud=fastapi-api, azp=cli-test, realm_access={'roles':['user']}`; bob → same `iss/aud/azp`, `realm_access={'roles':['admin','user']}`; `exp` present (e.g. `1793865029`); `sid` present (e.g. `59c88e47-1b22-45a4-b1a0-6a91e06add92`); `--refresh` returned a refresh JWT (`eyJhbGciOiJIUzUxMiIsInR5cCIgOiAiSldUIiwi…`); bad password → `exit=1` / `Keycloak error: invalid_grant`. | PASS |
| G5 | Clean start: `down -v` → `up -d` → healthy → G1–G4 pass from fresh import | run sequence | `down -v` removed container + `keycloak_default` network; `up -d` recreated; health poll `starting… → t=55s status=healthy`. Fresh re-runs: G1 kid match True, G2 `/admin/ 302` + admin token `200`, G3 logout URI present, G4 alice `['user']` / bob `['admin','user']`. | PASS |
| G6 | `.commandcode/` in `.gitignore`; `.env` files untracked | git + check-ignore | `git check-ignore -v .commandcode/` → `.gitignore:23:.commandcode/`; `git ls-files | grep -i .env` → none tracked; `find . -name '.env*'` → none on disk. | PASS |

## PHASE 2 — Backend (B1–B10)

| ID | Requirement | How verified | Evidence | Status |
|----|-------------|--------------|----------|--------|
| B1 | `app/config.py` reads ISSUER/JWKS_URL/AUDIENCE/CLIENT ID/SECRET from env with matching defaults | read file + `.env.example` | | TODO |
| B2 | JWKS via `httpx`, cached with TTL; unknown `kid` → refresh once then fail | code review + forced-rotation test | | TODO |
| B3 | PyJWT verify: `RS256` only (reject HS256/`none`), verify sig/exp/iss/aud, require exp/iss/aud, leeway explained | code + alg=none test | | TODO |
| B4 | `get_current_user` dependency: 401 + `WWW-Authenticate: Bearer` for missing/malformed/expired/bad-sig/wrong-iss/wrong-aud | curl matrix | | TODO |
| B5 | `require_role("admin")` → 403 for valid token missing role | curl alice /admin | | TODO |
| B6 | Routes `/public`, `/profile`, `/admin`, `/health` | curl | | TODO |
| B7 | All non-public routes use the dependency; README line on protecting a new route | code + README | | TODO |
| B8 | CORS only `http://localhost:3000`, allow `Authorization` | code + preflight curl | | TODO |
| B9 | `POST /introspect-demo` uses fastapi-api credentials, shows `active=true/false` | curl | | TODO |
| B10 | Run command documented: `uvicorn app.main:app --reload --port 8000` | README | | TODO |

## PHASE 3 — Frontend (F1–F12)

| ID | Requirement | How verified | Evidence | Status |
|----|-------------|--------------|----------|--------|
| F1 | PKCE helper: verifier 43–128, S256 challenge, random state (Web Crypto) | code + node check | | TODO |
| F2 | Login button: saves verifier/state, redirects with PKCE params | code | | TODO |
| F3 | `/callback`: read code/state, reject mismatch, show error params | code | | TODO |
| F4 | Code exchange with `code_verifier` + Strict Mode double-run guard | code | | TODO |
| F5 | Tokens in memory + sessionStorage, comment on HttpOnly alternative | code | | TODO |
| F6 | Home shows login state, decoded access/refresh/ID tokens, expiry countdown | code | | TODO |
| F7 | Button "Call /public" | code | | TODO |
| F8 | Button "Call /profile" with Bearer | code | | TODO |
| F9 | Button "Call /admin" showing 200/403/401 | code | | TODO |
| F10 | Button "Refresh token" + failure handling | code | | TODO |
| F11 | Button "Logout" via end_session_endpoint + clear storage | code | | TODO |
| F12 | `lib/config.ts` from `NEXT_PUBLIC_*`, `.env.local.example`, no hardcoded URLs | code | | TODO |
| F13 | `npm run build` passes with no TS errors | build output | | TODO |
| F14 | `npm run lint` passes | lint output | | TODO |
| F15 | Manual browser test script provided | TESTING.md | | TODO |

## PHASE 4 — Tests & Learning (T1–T10, D1–D3)

| ID | Requirement | How verified | Evidence | Status |
|----|-------------|--------------|----------|--------|
| T1 | `scripts/get_token.sh <user> <password>` prints access (+refresh) token | run it | | TODO |
| T2 | `scripts/run_tests.sh` runs all cases a–k with PASS/FAIL + summary | run it | | TODO |
| T3 | TESTING.md documents case a (valid→200) and b (none→401) | TESTING.md | | TODO |
| T4 | TESTING.md case c: expired token (wait 65s) → 401 | TESTING.md + script | | TODO |
| T5 | TESTING.md case d: tampered payload → 401 | TESTING.md + script | | TODO |
| T6 | TESTING.md case e: `alg=none` forged → 401 | TESTING.md + script | | TODO |
| T7 | TESTING.md case f: wrong audience → 401 | TESTING.md + script | | TODO |
| T8 | TESTING.md case g: alice /admin→403, bob /admin→200 | TESTING.md + script | | TODO |
| T9 | TESTING.md cases h/i/j: refresh, logout invalid_grant, introspection active true/false | TESTING.md + script | | TODO |
| T10 | TESTING.md case k: token still valid offline after logout (explained) | TESTING.md + script | | TODO |
| D1 | LEARNING.md plain-English token/JWT/RS256/JWKS/PKCE explanations + flow diagram | LEARNING.md | | TODO |
| D2 | LEARNING.md "10 questions my teacher may ask" with answers | LEARNING.md | | TODO |
| D3 | LEARNING.md "10 most common errors and fixes" | LEARNING.md | | TODO |

## PHASE 5 — Final audit (A1–A6)

| ID | Requirement | How verified | Evidence | Status |
|----|-------------|--------------|----------|--------|
| A1 | Map each of the 5 original task points to files + checklist items | written mapping | | TODO |
| A2 | Print final checklist, list every non-PASS item and why | this file | | TODO |
| A3 | Clean-start test: `docker compose down -v` → up → backend → `run_tests.sh` | command output | | TODO |
| A4 | README with exact start order, URLs, passwords, Codespaces note | README.md | | TODO |
| A5 | `git status` clean of secrets; commit (no push) | git output | | TODO |
| A6 | "What I could not verify" + "Known limitations" | README/final message | | TODO |

---

## Environment notes

- Claimed prerequisites (`/backend` with `.venv`, `/frontend` Next.js,
  pulled `keycloak:26.0` image) were **NOT present** at session start —
  repo contained only `README.md`. Recorded here for honesty.
