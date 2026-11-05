# LEARNING.md

A short, plain-English explanation of everything this lab uses.

## 1. The three tokens

When you log in, Keycloak gives you three tokens.

**Access token.**
This is your key to the API. You send it with every request.
It is short-lived. In this lab it lasts 60 seconds.
It says who you are and what roles you have.

**Refresh token.**
This is a longer-lived token. You use it to get a new access token when the
old one expires. You send it only to Keycloak, never to the API.
In this lab it lasts as long as the SSO session (30 minutes idle).

**ID token.**
This one is about the login itself, not about the API. It tells the browser
who just logged in and when. The API does not use it.

Simple rule: access token = for the API. Refresh token = for Keycloak.
ID token = for the app to show "hello, this is who logged in".

## 2. What a JWT looks like

A JWT is three base64url parts joined by dots:

```
header.payload.signature
```

**Header** — small JSON. It says which signing algorithm was used and which
key. Example: `{"alg": "RS256", "kid": "..."}`.

**Payload** — JSON with the claims (the facts). Example: `iss`, `aud`, `exp`,
`sub`, `realm_access`.

**Signature** — the proof. Keycloak signs `header.payload` with its private
key. Anyone with the matching public key can check it. Nobody without the
private key can make a valid one.

Important: you can read the header and payload without any key at all. They
are just base64, not encrypted. Reading is not verifying. Only the signature
proves the token is real.

## 3. How RS256 verification works with JWKS

RS256 means "RSA signature with SHA-256". It uses two keys: a private key to
sign and a public key to verify.

Keycloak keeps the private key secret. It publishes the public keys at the
JWKS endpoint:

```
http://localhost:8080/realms/demo-realm/protocol/openid-connect/certs
```

That endpoint has more than one key. There is a signing key (`use=sig`,
`alg=RS256`) and an encryption key (`use=enc`, `alg=RSA-OAEP`). Our backend
keeps only the signing keys.

To verify a token:

1. Read the token header. Get `kid` (key id) and `alg`.
2. Refuse anything that is not `RS256`. Refuse `none`. Refuse `HS256`.
3. Find the public key whose `kid` matches.
4. Check the signature with that key.
5. Check `exp`, `iss` and `aud`.
6. If all pass, trust the claims.

## 4. The claim names

- `iss` — issuer. Who made the token. Must be
  `http://localhost:8080/realms/demo-realm`.
- `aud` — audience. Who the token is for. Must contain `fastapi-api`.
- `exp` — expiry time. After this, the token is invalid.
- `kid` — key id. Which signing key was used.
- `azp` — authorized party. Which client asked for the token.
- `sid` — session id. Which login session the token belongs to.

## 5. Keycloak sessions

Every login creates a session in Keycloak. The session has an idle timeout and
a maximum lifetime. Your access token, refresh token and ID token all point
back to that session.

Logging out ends the session in Keycloak. After that:

- the refresh token stops working (`invalid_grant`),
- the access token is "not active" when you ask Keycloak about it.

## 6. Expiry and revocation, and a real limitation

Expiry is easy: after `exp`, every verifier rejects the token.

Revocation is harder. Our API verifies tokens **offline**. It checks the
signature and the claims. It does not call Keycloak on every request. So if a
session is revoked after a token was issued, the API keeps accepting that
token until it expires. Case **k** in `TESTING.md` shows exactly this.

How to reduce the window:

- Keep the access-token lifetime short (here it is 60 seconds).
- For sensitive actions, call **introspection** (RFC 7662) to ask Keycloak if
  the token is still active. If the answer is `active=false`, refuse it.
- Use logout plus a short lifetime instead of trying to revoke long-lived
  tokens instantly.

## 7. The PKCE flow, step by step

PKCE is "Proof Key for Code Exchange". It protects the login of public clients
(browsers and mobile apps), which have no secret.

```
1. Browser makes a random "code_verifier".
2. Browser hashes it with SHA-256 -> "code_challenge".
3. Browser saves the verifier locally and sends the challenge to Keycloak:
      GET /auth?...&code_challenge=...&code_challenge_method=S256
4. Keycloak shows the login page. User logs in.
5. Keycloak redirects back with a short-lived "code":
      GET /callback?code=...&state=...
6. Browser checks that "state" matches what it sent (CSRF check).
7. Browser POSTs the code AND the original verifier to the token endpoint:
      POST /token  grant_type=authorization_code  code=...  code_verifier=...
8. Keycloak hashes the verifier again. It must match the challenge from step 3.
9. If it matches, Keycloak returns access + refresh + ID tokens.
10. Browser keeps the tokens and calls the API with the access token.
```

## 8. Why PKCE is needed for public clients

A browser cannot keep a secret. Anyone can view the JavaScript, so a
`client_secret` in a frontend is not secret at all. Without PKCE, an attacker
who steals the authorization code could swap it for tokens. PKCE fixes this:
the code is useless without the verifier, and the verifier never leaves the
browser before the exchange.

## 9. Why the frontend never verifies the signature

The frontend can decode a JWT, but it cannot verify the signature in a way you
should trust. Any check the browser makes can be bypassed by editing the page.
So the frontend only **displays** decoded tokens. The backend is the single
place that verifies signatures, issuer, audience and expiry. If the backend
says 200, the token is real. If it says 401, it is not.
