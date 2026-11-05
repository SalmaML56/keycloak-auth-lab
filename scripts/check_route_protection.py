#!/usr/bin/env python3
"""Guard: every application route except the allowlisted public ones must
carry the auth dependency. Exits non-zero if an unprotected route exists.

Run with the backend virtualenv:
  backend/.venv/bin/python scripts/check_route_protection.py
"""

import sys
from pathlib import Path

from fastapi.routing import APIRoute

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.auth import has_auth_dependency  # noqa: E402
from app.main import app  # noqa: E402

PUBLIC_PATHS = {"/public", "/health"}
INTERNAL_PATHS = {"/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"}


def main() -> int:
    unprotected: list[str] = []
    checked = 0
    skipped: list[str] = []

    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        path = route.path
        if path in INTERNAL_PATHS:
            skipped.append(path)
            continue
        if path in PUBLIC_PATHS:
            print(f"  OK    {path:<20} public (allowlisted)")
            checked += 1
            continue
        if has_auth_dependency(route.dependant):
            print(f"  OK    {path:<20} protected")
            checked += 1
            continue
        print(f"  FAIL  {path:<20} NO AUTH DEPENDENCY")
        unprotected.append(path)

    for path in skipped:
        print(f"  SKIP  {path:<20} fastapi-internal")

    if unprotected:
        print(f"\nFAIL: {len(unprotected)} unprotected route(s): {', '.join(unprotected)}")
        return 1

    print(f"\nPASS: all {checked} application routes are protected (or public by design).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
