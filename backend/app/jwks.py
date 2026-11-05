"""JWKS fetching, caching and key selection.

Keycloak exposes one or more signing keys at the realm's `certs` endpoint.
We fetch them with httpx, cache the usable ones in memory with a TTL, and
look them up by the `kid` in the token header.
"""

import asyncio
import logging
import time
from typing import Optional

import httpx
from jwt import PyJWK

from . import config

logger = logging.getLogger("app.jwks")


class JwksCache:
    def __init__(self) -> None:
        self._by_kid: dict[str, PyJWK] = {}
        self._fetched_at: float = 0.0
        self._lock = asyncio.Lock()
        # Counters exposed for the caching/rotation proof (see /health).
        self.fetch_count = 0
        self.last_refresh_reason: Optional[str] = None

    def key_count(self) -> int:
        return len(self._by_kid)

    def age_seconds(self) -> Optional[float]:
        if self._fetched_at == 0.0:
            return None
        return time.monotonic() - self._fetched_at

    def _is_fresh(self) -> bool:
        if not self._by_kid:
            return False
        return self.age_seconds() < config.JWKS_CACHE_TTL_SECONDS

    async def _refresh(self, reason: str) -> None:
        async with httpx.AsyncClient(timeout=config.HTTP_TIMEOUT_SECONDS) as client:
            response = await client.get(config.JWKS_URL)
            response.raise_for_status()
            body = response.json()

        usable: dict[str, PyJWK] = {}
        for jwk in body.get("keys", []):
            # A Keycloak realm publishes more than one key: a signing key
            # (use=sig, alg=RS256) and an encryption key (use=enc,
            # alg=RSA-OAEP). Only the signing key can verify an access
            # token's signature. If we handed the whole key set to PyJWT it
            # could pick the encryption key for the same kid-space and fail
            # with a confusing "signature verification failed". So we keep
            # only use=sig AND alg=RS256, index them by kid, and later match
            # the token's kid exactly.
            if jwk.get("use") == "sig" and jwk.get("alg") == "RS256":
                usable[jwk["kid"]] = PyJWK(jwk)

        self._by_kid = usable
        self._fetched_at = time.monotonic()
        self.fetch_count += 1
        self.last_refresh_reason = reason
        logger.info(
            "JWKS refreshed (reason=%s): %d usable RS256/sig key(s); total fetches=%d",
            reason,
            len(usable),
            self.fetch_count,
        )

    async def get_signing_key(self, kid: str) -> Optional[PyJWK]:
        """Return the signing key for `kid`, refreshing the cache if needed.

        Refreshes when the cache is stale OR when the requested kid is not
        present. On an unknown kid we refresh exactly once and then give up
        (returning None), which the caller turns into a 401.
        """
        if self._is_fresh() and kid in self._by_kid:
            return self._by_kid[kid]

        async with self._lock:
            # Double-checked: another coroutine may have refreshed while we
            # waited for the lock.
            if self._is_fresh() and kid in self._by_kid:
                return self._by_kid[kid]
            reason = "unknown-kid" if self._by_kid else "cold-cache"
            await self._refresh(reason)

        return self._by_kid.get(kid)


cache = JwksCache()
