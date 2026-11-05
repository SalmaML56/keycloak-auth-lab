# keycloak-auth-lab

A hands-on lab for OAuth 2.0 / OpenID Connect. Three services work together:

1. **Keycloak 26** (Docker) — the identity provider: one realm, three clients,
   two roles, two users.
2. **FastAPI backend** — protected APIs that verify Keycloak access tokens
   (RS256 against JWKS), including role checks and RFC 7662 introspection.
3. **Next.js frontend** — logs in with Authorization Code + PKCE, hand-rolled
   with the Web Crypto API (no auth libraries).

The point of the lab is to *see* every step: the login redirect, the PKCE
verifier/challenge, the code exchange, the tokens, expiry, refresh, logout and
the difference between offline verification and introspection.

Read `LEARNING.md` for the explanations, `TESTING.md` for how to test,
`QUESTIONS.md` for likely exam questions and `ERRORS.md` for common problems.

## Folder structure

```
keycloak/        docker-compose.yml + realm-export.json (realm, clients, roles, users)
backend/         FastAPI app (app/config.py, app/jwks.py, app/auth.py, app/main.py) + .env.example
frontend/        Next.js app (app/, lib/) + scripts/ (PKCE + auth-url + e2e checks)
scripts/         get_token.sh, make_bad_tokens.py, wrong_aud_token.sh,
                 check_route_protection.py, run_tests.sh
CHECKLIST.md     requirement-by-requirement status with real evidence
TESTING.md       automated cases a–k + manual browser script
LEARNING.md      plain-English explanations
QUESTIONS.md     10 exam questions with answers
ERRORS.md        10 common errors and fixes
```

## Start it (in this order)

All three are started from the repository root.

**1. Keycloak** (must be up first — the other two talk to it)

```bash
docker compose -f keycloak/docker-compose.yml up -d
# wait until healthy:
docker inspect --format '{{.State.Health.Status}}' keycloak     # -> healthy
```

**2. Backend** (FastAPI on :8000)

```bash
cd backend
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
./.venv/bin/uvicorn app.main:app --reload --port 8000
```

**3. Frontend** (Next.js on :3000) — in a second terminal

```bash
cd frontend
npm install
npm run dev
```

Then open **http://localhost:3000** and click **Login with Keycloak**.

## URLs

| Service | URL | Notes |
|---------|-----|-------|
| Frontend | http://localhost:3000 | the app; login button here |
| Frontend callback | http://localhost:3000/callback | registered redirect URI |
| Backend API | http://localhost:8000 | `/public`, `/health`, `/profile`, `/admin`, `/introspect-demo` |
| Backend docs | http://localhost:8000/docs | FastAPI Swagger UI |
| Keycloak | http://localhost:8080 | realm `demo-realm` |
| Keycloak admin console | http://localhost:8080/admin/ | `admin` / `admin` (dev only) |
| JWKS | http://localhost:8080/realms/demo-realm/protocol/openid-connect/certs | public signing keys |

## Test users (DEV ONLY)

| Username | Password | Realm roles |
|----------|----------|-------------|
| `alice` | `alice123` | `user` |
| `bob` | `bob123` | `user`, `admin` |
| `admin` (Keycloak console) | `admin` | master-realm admin |

These are throwaway lab credentials committed on purpose so the lab runs
anywhere. Never reuse them outside this lab.

## Running the tests

```bash
# Backend + frontend unit/automated checks
backend/.venv/bin/python scripts/check_route_protection.py   # every route is protected
cd frontend && npm run build && npm run lint                 # build + lint, zero errors
cd frontend && npm run test:pkce                             # RFC 7636 PKCE vector
cd frontend && npm run check:auth-url                        # login URL accepted by Keycloak
cd frontend && bash scripts/e2e_login_check.sh               # full login+exchange+refresh+replay

# End-to-end suite (needs Keycloak :8080 and the backend :8000 already up)
scripts/run_tests.sh          # cases a–k, ~75s (case c waits for expiry)
scripts/run_tests.sh --fast   # same but skips case c
```

`scripts/run_tests.sh` starts nothing: it checks both services are reachable
and exits with a clear message if not. It prints PASS/FAIL per case and a
summary, and never prints tokens.

## Codespaces note

The Keycloak client is registered for `localhost`. In a Codespace, **use
VS Code Desktop** (not the browser version) so the forwarded ports appear as
`localhost` inside the editor — then `localhost:8080`, `localhost:8000` and
`localhost:3000` all work and no Keycloak settings need changing.

If you must use the browser-based Codespace, the app is served from
`https://<codespace>-3000.app.github.dev` instead. Then you must:

- add `https://<codespace>-3000.app.github.dev/callback` to `nextjs-app`'s
  **Valid redirect URIs** and the origin to **Web origins** (and the post
  logout redirect URI), and
- set `NEXT_PUBLIC_REDIRECT_URI` / `NEXT_PUBLIC_POST_LOGOUT_REDIRECT_URI` /
  `NEXT_PUBLIC_API_BASE_URL` in `frontend/.env.local` to the forwarded URLs, and
- make the ports public.

## Backend: protecting a new route

Add the auth dependency to any route that should require a valid token:

```python
from fastapi import Depends
from app.auth import get_current_user, require_role

@app.get("/new")
async def new(user: dict = Depends(get_current_user)):   # valid token required
    ...

@app.get("/admin-only")
async def admin_only(user: dict = Depends(require_role("admin"))):  # + role
    ...
```

Rules enforced in this repo:

- Only `/public` and `/health` are unauthenticated. **Every other route must
  use `Depends(get_current_user)` or `Depends(require_role(...))`.**
- `scripts/check_route_protection.py` walks every registered route and exits
  non-zero if it finds an unprotected one.

### Routes

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /public` | none | sanity check, always 200 |
| `GET /health` | none | liveness + JWKS cache counters |
| `GET /profile` | token | echo the caller's claims |
| `GET /admin` | token + `admin` role | 403 for a valid token without the role |
| `POST /introspect-demo` | token | RFC 7662 introspection via the `fastapi-api` client |

## Security notes — everything below is DEV ONLY

This lab is deliberately insecure in places so the mechanics are visible. Do
**not** copy these into production:

- **`admin` / `admin`** for the Keycloak console, and bootstrap admin
  credentials in `docker-compose.yml`.
- **A client secret is committed to git.** `keycloak/realm-export.json`
  contains `"secret": "fastapi-api-secret"` for the `fastapi-api` client, and
  it appears in `backend/.env.example` and `backend/app/config.py` as a
  default. Real secrets belong in a secret manager / CI variables, never in a
  repo. Even this dev secret would be rotated in any real deployment.
- **A direct access grants client (`cli-test`)** is enabled so scripts and
  tests can get a token with a username and password. The Resource Owner
  Password Credentials grant is deprecated and should be off in production.
- **Tokens are kept in `sessionStorage`** in the browser. Any XSS can read
  them. The safer pattern is a server-set `HttpOnly`, `Secure` cookie.
- **`sslRequired: none`** in the realm and plain HTTP everywhere.
- **User passwords (`alice123`, `bob123`) are in the realm export.**

Access tokens last **60 seconds** on purpose; the refresh token follows the SSO
session (30 min idle / 10 h max).
