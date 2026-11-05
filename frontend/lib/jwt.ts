// Tiny JWT *decoder* for display only.
//
// !!! THIS IS NOT VERIFICATION !!!
// It base64url-decodes and JSON-parses the token so a human can read it. It
// does NOT check the signature, `exp`, `iss` or `aud`. Anyone can forge a
// token that decodes cleanly. Only the backend verifies signatures (RS256
// against Keycloak's JWKS) — the browser must never treat this as trust.

export type DecodedJwt = {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
};

function base64UrlDecodeToString(segment: string): string {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(withPadding);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function decodeJwt(token: string): DecodedJwt {
  const parts = token.split(".");
  if (parts.length < 2) {
    throw new Error("Not a JWT (expected at least header.payload)");
  }
  return {
    header: JSON.parse(base64UrlDecodeToString(parts[0])),
    payload: JSON.parse(base64UrlDecodeToString(parts[1])),
  };
}
