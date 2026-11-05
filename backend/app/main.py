"""FastAPI application: Keycloak-protected routes for the auth lab."""

import logging

import httpx
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import config
from .auth import bearer_scheme, get_current_user, require_role
from .jwks import cache as jwks_cache

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = FastAPI(title="Keycloak Auth Lab API", version="1.0.0")

# Only the Next.js dev origin may call us from a browser, and only the
# Authorization header is needed for credentials (tokens travel in the
# Authorization header, not cookies, so allow_credentials stays off).
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    allow_credentials=False,
)


# --------------------------------------------------------------------------
# Public routes (no token required)
# --------------------------------------------------------------------------
@app.get("/public")
async def public() -> dict:
    return {"message": "This route is public.", "authenticated": False}


@app.get("/health")
async def health() -> dict:
    """Liveness plus a peek at the JWKS cache (used by the lab's proofs)."""
    return {
        "status": "ok",
        "jwks_key_count": jwks_cache.key_count(),
        "jwks_fetch_count": jwks_cache.fetch_count,
        "jwks_last_refresh_reason": jwks_cache.last_refresh_reason,
        "jwks_cache_age_seconds": jwks_cache.age_seconds(),
        "jwks_cache_ttl_seconds": config.JWKS_CACHE_TTL_SECONDS,
    }


# --------------------------------------------------------------------------
# Protected routes (require a valid access token)
# --------------------------------------------------------------------------
@app.get("/profile")
async def profile(user: dict = Depends(get_current_user)) -> dict:
    return {
        "username": user.get("preferred_username"),
        "email": user.get("email"),
        "roles": user.get("realm_access", {}).get("roles", []),
        "issuer": user.get("iss"),
        "audience": user.get("aud"),
        "expires_at": user.get("exp"),
    }


@app.get("/admin")
async def admin(user: dict = Depends(require_role("admin"))) -> dict:
    return {
        "message": "Welcome, admin.",
        "username": user.get("preferred_username"),
        "roles": user.get("realm_access", {}).get("roles", []),
    }


class IntrospectRequest(BaseModel):
    token: str | None = None


@app.post("/introspect-demo")
async def introspect_demo(
    body: IntrospectRequest | None = None,
    credentials=Depends(bearer_scheme),
    _user: dict = Depends(get_current_user),
) -> dict:
    """Introspect a token using the confidential `fastapi-api` client.

    Demonstrates the RFC 7662 introspection flow with client credentials.
    The token being inspected is never echoed back or logged.
    """
    token = (body.token if body and body.token else None) or (
        credentials.credentials if credentials else None
    )
    if not token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide a token in the JSON body or as a bearer token.",
        )

    async with httpx.AsyncClient(timeout=config.HTTP_TIMEOUT_SECONDS) as client:
        response = await client.post(
            config.INTROSPECTION_URL,
            data={"token": token},
            auth=(config.CLIENT_ID, config.CLIENT_SECRET),
        )

    if response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Introspection endpoint returned {response.status_code}",
        )

    data = response.json()
    active = bool(data.get("active"))
    return {
        "active": active,
        # Only non-sensitive fields, and only when the token is active.
        "username": data.get("preferred_username") if active else None,
        "client_id": data.get("azp") if active else None,
        "expires_at": data.get("exp") if active else None,
    }
