#!/usr/bin/env python3
"""DEV/TESTING ONLY — hand-craft broken JWTs to prove the API rejects them.

Modes:
  none                 An unsigned token with header {"alg": "none"}.
                       The API must reject it before any signature check.
  tamper <real-token>  Take a real token, rewrite its payload (escalate the
                       role to "admin"), and keep the original signature.
                       The signature no longer matches -> 401.

Usage:
  scripts/make_bad_tokens.py none
  scripts/make_bad_tokens.py tamper "$ACCESS_TOKEN"
"""

import base64
import json
import sys
import time

EXPECTED_ISSUER = "http://localhost:8080/realms/demo-realm"
EXPECTED_AUDIENCE = "fastapi-api"


def b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def b64url_decode(segment: str) -> bytes:
    return base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))


def make_alg_none(
    issuer: str = EXPECTED_ISSUER, audience: str = EXPECTED_AUDIENCE
) -> str:
    """A token that *looks* valid but carries no signature."""
    header = {"alg": "none", "typ": "JWT"}
    now = int(time.time())
    payload = {
        "iss": issuer,
        "aud": audience,
        "sub": "attacker",
        "preferred_username": "alg-none-attacker",
        "iat": now,
        "exp": now + 3600,
        "realm_access": {"roles": ["admin"]},
    }
    return (
        f"{b64url_encode(json.dumps(header).encode())}."
        f"{b64url_encode(json.dumps(payload).encode())}."
    )


def tamper_payload(token: str) -> str:
    """Keep header+signature, rewrite the payload to escalate privileges."""
    header, payload, signature = token.split(".")
    claims = json.loads(b64url_decode(payload))
    claims.setdefault("realm_access", {})["roles"] = ["admin"]
    claims["preferred_username"] = "tampered-admin"
    return (
        f"{header}."
        f"{b64url_encode(json.dumps(claims).encode())}."
        f"{signature}"
    )


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2

    mode = argv[1]
    if mode == "none":
        print(make_alg_none())
        return 0
    if mode == "tamper":
        if len(argv) < 3:
            print("tamper mode needs a real token as the second argument", file=sys.stderr)
            return 2
        print(tamper_payload(argv[2]))
        return 0

    print(f"unknown mode: {mode}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
