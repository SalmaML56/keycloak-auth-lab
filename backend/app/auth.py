"""Token verification and FastAPI auth dependencies."""

import logging
from typing import Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import (
    ExpiredSignatureError,
    ImmatureSignatureError,
    InvalidAudienceError,
    InvalidIssuerError,
    InvalidSignatureError,
    InvalidTokenError,
    MissingRequiredClaimError,
)

from . import config
from .jwks import cache as jwks_cache

logger = logging.getLogger("app.auth")

# Marker attribute so the route-protection check (scripts/check_route_protection.py)
# can recognise our auth dependency while walking a route's dependency tree.
AUTH_MARKER = "__is_auth_dependency__"

# auto_error=False so *we* decide the error, and so a missing/!bearer header
# becomes a clean 401 rather than FastAPI's default 403.
bearer_scheme = HTTPBearer(auto_error=False)


def _mark_auth(fn):
    setattr(fn, AUTH_MARKER, True)
    return fn


def _unauthorized(detail: str) -> HTTPException:
    # 401 must advertise the scheme the client should use.
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


@_mark_auth
async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict[str, Any]:
    """Verify the bearer token and return its claims, or raise 401."""
    if credentials is None or not credentials.credentials:
        raise _unauthorized("Missing bearer token")

    token = credentials.credentials

    # 1) Read the header WITHOUT trusting it. We only use it to pick an
    #    algorithm and a key — never to decide whether the token is valid.
    try:
        header = jwt.get_unverified_header(token)
    except InvalidTokenError:
        raise _unauthorized("Malformed token")

    alg = header.get("alg")
    kid = header.get("kid")

    # 2) Pin the algorithm. This rejects `alg: none` (unsigned) and `alg:
    #    HS256` (symmetric) up front, so neither can ever reach the
    #    signature check — this is what blocks the classic "HS256 signed
    #    with the public key" confusion attack.
    if alg != "RS256":
        raise _unauthorized("Unsupported token algorithm")

    if not kid:
        raise _unauthorized("Token is missing a key id (kid)")

    # 3) Fetch the matching signing key (may trigger one JWKS refresh).
    signing_key = await jwks_cache.get_signing_key(kid)
    if signing_key is None:
        raise _unauthorized("Unknown signing key")

    # 4) Full verification: signature + exp + iss + aud, all required.
    try:
        claims = jwt.decode(
            token,
            key=signing_key.key,
            algorithms=config.ALGORITHMS,
            audience=config.AUDIENCE,
            issuer=config.ISSUER,
            leeway=config.JWT_LEEWAY_SECONDS,
            options={"require": ["exp", "iss", "aud"], "verify_signature": True},
        )
    except ExpiredSignatureError:
        raise _unauthorized("Token expired")
    except ImmatureSignatureError:
        raise _unauthorized("Token not yet valid")
    except InvalidAudienceError:
        raise _unauthorized("Wrong audience")
    except InvalidIssuerError:
        raise _unauthorized("Wrong issuer")
    except InvalidSignatureError:
        raise _unauthorized("Invalid signature")
    except MissingRequiredClaimError:
        raise _unauthorized("Token is missing a required claim")
    except InvalidTokenError:
        raise _unauthorized("Invalid token")

    return claims


def require_role(role: str):
    """Dependency factory: require a realm role on top of a valid token."""

    @_mark_auth
    async def _checker(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        roles = user.get("realm_access", {}).get("roles", [])
        if role not in roles:
            # Valid token, insufficient rights -> 403 (not 401).
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires role: {role}",
            )
        return user

    return _checker


def has_auth_dependency(dependant) -> bool:
    """True if `dependant` (or any nested dependency) is one of ours."""
    for dependency in dependant.dependencies:
        if getattr(dependency.call, AUTH_MARKER, False):
            return True
        if has_auth_dependency(dependency):
            return True
    return False
