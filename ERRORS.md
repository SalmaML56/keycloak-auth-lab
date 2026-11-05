# ERRORS.md

Ten errors you will hit in this lab, and how to fix them.

**1. Issuer mismatch — `401 {"detail":"Wrong issuer"}`**
The `iss` in the token is not what the backend expects. Check
`ISSUER` in `backend/.env` against the realm. It must be exactly
`http://localhost:8080/realms/demo-realm` (no trailing slash, correct port).
Fix: correct `ISSUER`, or point the backend at the right realm.

**2. Audience mismatch — `401 {"detail":"Wrong audience"}`**
The token's `aud` does not contain `fastapi-api`. Usually the client has no
audience mapper, or the backend's `AUDIENCE` is wrong. Fix: keep the
`fastapi-api-audience` protocol mapper on the client, and set
`AUDIENCE=fastapi-api`. Inspect the token's `aud` to confirm.

**3. Redirect URI mismatch — Keycloak shows "Invalid parameter: redirect_uri"**
The `redirect_uri` sent does not exactly match one registered on the client.
It is an exact string match, including scheme, host, port and path. Fix: in
`nextjs-app`, add `http://localhost:3000/callback`. Use `localhost`, not
`127.0.0.1`, if that is what you send.

**4. CORS error in the browser console**
The browser blocked a cross-origin call (frontend on :3000, API on :8000).
Fix: the API allows only `http://localhost:3000` and the `Authorization`
header (see `ALLOWED_ORIGINS`). If you use a different origin, add it. Check
the preflight with
`curl -i -X OPTIONS http://localhost:8000/profile -H "Origin: http://localhost:3000"`.

**5. `invalid_grant` from using the code twice**
The authorization code is single-use. A second exchange fails. This happens in
React Strict Mode if the callback has no guard. Fix: keep the ref +
sessionStorage guard in `app/callback/page.tsx` (case i proves the replay).

**6. "Account is not fully set up"**
The user has a required action (for example "Update Password") or a temporary
password. Fix: set `temporary: false` on the credential and clear required
actions. In this lab the realm export already marks alice and bob as
`emailVerified=true` with no required actions.

**7. Clock skew — "Token not yet valid" or "Token expired" immediately**
The token's `iat`/`exp` do not line up with the verifier's clock. Common in
containers. Fix: keep the small leeway (`JWT_LEEWAY_SECONDS=10` here), and make
sure host and container clocks are in sync.

**8. Codespaces port visibility — login redirects to the wrong host**
In Codespaces the app is not on `localhost`. Keycloak needs the forwarded URL
in the client's redirect URIs, web origins and post-logout redirect URIs.
Fix: add `https://<codespace>-3000.app.github.dev/callback` (and the origin)
to `nextjs-app`, and set `NEXT_PUBLIC_REDIRECT_URI` /
`NEXT_PUBLIC_POST_LOGOUT_REDIRECT_URI` to the forwarded URL. Also make the
ports public.

**9. Wrong JWKS URL — backend can't fetch keys (500 / unknown key)**
Pointing JWKS at the wrong realm gives a 404 and no keys. Fix: the JWKS URL
must be
`http://localhost:8080/realms/demo-realm/protocol/openid-connect/certs`.
If you override `ISSUER` for testing, remember `JWKS_URL` defaults from it.

**10. Expired token while testing**
Access tokens last 60s, so a token you copied a minute ago is dead. Fix: fetch
a fresh one with `scripts/get_token.sh alice alice123` right before the call,
or click **Refresh token** in the UI. For quick reruns, use
`scripts/run_tests.sh --fast` to skip the 75-second expiry case.
