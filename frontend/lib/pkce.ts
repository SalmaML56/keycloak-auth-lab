// PKCE (RFC 7636) helpers built only on the Web Crypto API.
// No auth libraries are used anywhere in this project.

/** base64url-encode bytes WITHOUT padding, as required by RFC 7636. */
export function base64UrlEncode(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** `byteLength` cryptographically-random bytes, base64url-encoded. */
export function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * Create a code verifier. RFC 7636 requires 43..128 characters; 32 random
 * bytes encode to exactly 43 base64url characters.
 */
export function createVerifier(): string {
  return randomBase64Url(32);
}

/** S256 challenge: base64url(SHA-256(ASCII(verifier))). */
export async function createChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(digest);
}

/** Random `state` value to protect the callback against CSRF. */
export function createState(): string {
  return randomBase64Url(32);
}
