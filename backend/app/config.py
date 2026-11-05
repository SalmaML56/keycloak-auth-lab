"""Application configuration.

Every value is read from the environment (optionally via a local `.env`
file — see `.env.example`) and falls back to a default that matches the
Keycloak realm shipped in `keycloak/realm-export.json`. That means the app
runs out of the box against the local lab, but nothing is hard-coded: any
value can be overridden for a different environment.
"""

import os

from dotenv import load_dotenv

load_dotenv()

# --- Keycloak coordinates -------------------------------------------------
KEYCLOAK_BASE_URL = os.getenv("KEYCLOAK_BASE_URL", "http://localhost:8080")
KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "demo-realm")

# The `iss` we require in every token, and the JWKS we verify against.
ISSUER = os.getenv("ISSUER", f"{KEYCLOAK_BASE_URL}/realms/{KEYCLOAK_REALM}")
JWKS_URL = os.getenv("JWKS_URL", f"{ISSUER}/protocol/openid-connect/certs")
INTROSPECTION_URL = os.getenv(
    "INTROSPECTION_URL", f"{ISSUER}/protocol/openid-connect/token/introspect"
)

# --- Expected token audience ----------------------------------------------
# `aud` must contain this value. Our realm adds it to the access token via
# the `fastapi-api-audience` protocol mapper.
AUDIENCE = os.getenv("AUDIENCE", "fastapi-api")

# --- Confidential client credentials used for token introspection ---------
# These belong to the `fastapi-api` client in the realm export. They are a
# lab secret; in a real deployment they come from a secret manager, never
# from a committed file.
CLIENT_ID = os.getenv("CLIENT_ID", "fastapi-api")
CLIENT_SECRET = os.getenv("CLIENT_SECRET", "fastapi-api-secret")

# --- Browser origins allowed to call this API (CORS) ----------------------
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]

# --- Token verification tuning --------------------------------------------
# Only RS256 is ever accepted. HS256 (symmetric) and "none" (unsigned) are
# rejected before verification even starts; see app/auth.py.
ALGORITHMS = ["RS256"]

# How long a fetched JWKS is trusted before we re-download it.
JWKS_CACHE_TTL_SECONDS = int(os.getenv("JWKS_CACHE_TTL_SECONDS", "300"))

# Clock-skew tolerance applied to `exp`/`iat`. Keycloak and the API are
# usually the same machine in this lab, but in real deployments there is
# always some clock drift, so a small leeway stops "token just expired"
# flapping. 10s is deliberately small.
JWT_LEEWAY_SECONDS = int(os.getenv("JWT_LEEWAY_SECONDS", "10"))

HTTP_TIMEOUT_SECONDS = float(os.getenv("HTTP_TIMEOUT_SECONDS", "5"))
