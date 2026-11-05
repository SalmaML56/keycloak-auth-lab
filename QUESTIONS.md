# QUESTIONS.md

Ten questions a teacher may ask, with short answers.

**1. Why is the refresh token not sent to the API?**
The refresh token is a long-lived key to get new tokens. If the API received
it, a log or a bug could leak it, and an attacker could mint fresh access
tokens forever. The refresh token is only ever sent to Keycloak's token
endpoint. The API only ever sees short-lived access tokens.

**2. Why keep the access-token lifetime short?**
Because a token cannot be "un-issued". Our API verifies offline, so a revoked
token still works until it expires. A short lifetime (60s here) makes that bad
window small. The user stays logged in because the refresh token gets a new
access token.

**3. What happens if Keycloak rotates keys?**
Keycloak signs new tokens with a new `kid` and publishes the new public key in
JWKS. Old tokens still verify with the old key, which stays in JWKS for a
while. When our backend sees an unknown `kid`, it re-fetches JWKS once and
tries again. If the key is still unknown, it returns 401. So rotation needs no
restart and no config change.

**4. Why RS256 and not HS256?**
HS256 uses one shared secret to sign and to verify. The verifier would need
the same secret Keycloak signs with, and a public client cannot keep a secret.
Worse, an attacker could sign a token with the known public key and trick a
naive verifier (the "HS256 confusion" attack). RS256 uses a private key to
sign and a public key to verify. The public key is safe to share, and we tell
PyJWT to accept only RS256, so HS256 and `none` are rejected outright.

**5. What is the difference between 401 and 403?**
401 means "I don't know who you are" — no token, bad token, expired token.
403 means "I know who you are, but you may not do this" — a valid token
without the required role. The client's fix is different: 401 = log in,
403 = ask for the right permission.

**6. Why is tokens-in-sessionStorage not production-safe?**
Any JavaScript on the page can read sessionStorage. If the site ever has an
XSS bug, the attacker steals the tokens. The safer pattern is an HttpOnly,
Secure cookie set by the server, which JavaScript can never read. We use
sessionStorage only because this is a learning lab.

**7. Why is PKCE needed for a public client?**
A public client cannot keep a secret. PKCE makes the authorization code
useless without the one-time verifier that never leaves the browser. So a
stolen code cannot be exchanged for tokens.

**8. What is `kid`, and why filter keys by `use=sig` and `alg=RS256`?**
`kid` is the key id in the token header. It tells the verifier which public
key to use. JWKS publishes several keys — a signing key and an encryption key.
Only the signing key (`use=sig`, `alg=RS256`) can verify access tokens, so we
keep only those and match `kid` exactly.

**9. Offline JWT verification vs introspection — what is the difference?**
Offline verification checks the signature and claims locally. It is fast and
needs no network call, but it cannot notice an early logout. Introspection
(RFC 7662) asks Keycloak "is this token still active?" on demand. It sees
revocation immediately, but costs a network round trip. Best practice: offline
by default, introspection for sensitive actions.

**10. Why does the callback need a double-run guard?**
React Strict Mode runs effects twice in development, and the authorization
code is single-use. A second exchange returns `invalid_grant`. We guard with a
`useRef` (blocks the double-invoke in one mount) and a `sessionStorage` flag
(blocks a full remount). Case i in `TESTING.md` proves a replayed code fails.
