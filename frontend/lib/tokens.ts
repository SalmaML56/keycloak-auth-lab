// Token storage.
//
// Tokens are kept in memory (React state) and mirrored to sessionStorage so a
// page refresh keeps the session. This is a lab trade-off: the safest place
// for a browser session is an HttpOnly cookie set by the server, which
// JavaScript cannot read at all. sessionStorage is readable by any script on
// the page, so it is vulnerable to XSS — acceptable here only because this is
// a learning lab.

export const STORAGE_KEYS = {
  accessToken: "kc.access_token",
  refreshToken: "kc.refresh_token",
  idToken: "kc.id_token",
  expiresAt: "kc.access_token_expires_at", // epoch milliseconds
  verifier: "kc.pkce_verifier",
  state: "kc.oauth_state",
  codeConsumed: "kc.code_consumed",
} as const;

export type StoredTokens = {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  expiresAt: number;
};

function safeSession(): Storage | null {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

export function saveTokens(tokens: StoredTokens): void {
  const store = safeSession();
  if (!store) return;
  store.setItem(STORAGE_KEYS.accessToken, tokens.accessToken);
  store.setItem(STORAGE_KEYS.expiresAt, String(tokens.expiresAt));
  if (tokens.refreshToken) store.setItem(STORAGE_KEYS.refreshToken, tokens.refreshToken);
  else store.removeItem(STORAGE_KEYS.refreshToken);
  if (tokens.idToken) store.setItem(STORAGE_KEYS.idToken, tokens.idToken);
  else store.removeItem(STORAGE_KEYS.idToken);
}

export function loadTokens(): StoredTokens | null {
  const store = safeSession();
  if (!store) return null;
  const accessToken = store.getItem(STORAGE_KEYS.accessToken);
  if (!accessToken) return null;
  return {
    accessToken,
    refreshToken: store.getItem(STORAGE_KEYS.refreshToken),
    idToken: store.getItem(STORAGE_KEYS.idToken),
    expiresAt: Number(store.getItem(STORAGE_KEYS.expiresAt) ?? "0"),
  };
}

export function clearTokens(): void {
  const store = safeSession();
  if (!store) return;
  for (const key of [
    STORAGE_KEYS.accessToken,
    STORAGE_KEYS.refreshToken,
    STORAGE_KEYS.idToken,
    STORAGE_KEYS.expiresAt,
  ]) {
    store.removeItem(key);
  }
}

export function clearFlow(): void {
  const store = safeSession();
  if (!store) return;
  for (const key of [STORAGE_KEYS.verifier, STORAGE_KEYS.state, STORAGE_KEYS.codeConsumed]) {
    store.removeItem(key);
  }
}

export function tail(token: string, length = 6): string {
  return token.length <= length ? token : token.slice(-length);
}
