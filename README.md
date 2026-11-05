# keycloak-auth-lab

A hands-on lab for OAuth 2.0 / OpenID Connect: a Keycloak realm, a FastAPI
backend that verifies access tokens against it, and (later) a Next.js
frontend that logs in with Authorization Code + PKCE.

## Layout

- `keycloak/` — docker-compose + realm export for Keycloak 26.
- `backend/` — FastAPI API that validates Keycloak access tokens.
- `scripts/` — dev/testing helpers.
- `CHECKLIST.md` — requirement-by-requirement status with evidence.

## Backend (FastAPI)

### Run it

```bash
cd backend
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
./.venv/bin/uvicorn app.main:app --reload --port 8000
```

Configuration is read from the environment (see `backend/.env.example`);
the defaults already point at the local Keycloak on `http://localhost:8080`.

### Protecting a new route

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
  non-zero if it finds an unprotected one, so this is checked automatically:

  ```bash
  backend/.venv/bin/python scripts/check_route_protection.py
  ```

### Routes

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /public` | none | sanity check, always 200 |
| `GET /health` | none | liveness + JWKS cache counters |
| `GET /profile` | token | echo the caller's claims |
| `GET /admin` | token + `admin` role | 403 for a valid token without the role |
| `POST /introspect-demo` | token | RFC 7662 introspection via the `fastapi-api` client |

## Test helpers

- `scripts/get_token.sh <user> <password> [--refresh]` — dev-only password-grant
  token fetch (see the comment in the script).
- `scripts/make_bad_tokens.py none|tamper <token>` — hand-craft broken JWTs.
- `scripts/wrong_aud_token.sh` — mint a signed token with a wrong `aud`.
