"use client";

import { useCallback, useEffect, useState } from "react";
import { callApi, statusClass, type ApiResult } from "@/lib/api";
import { config } from "@/lib/config";
import { decodeJwt } from "@/lib/jwt";
import { buildAuthorizationUrl, buildLogoutUrl, refreshTokens, toStoredTokens } from "@/lib/oauth";
import { createChallenge, createState, createVerifier } from "@/lib/pkce";
import {
  clearFlow,
  clearTokens,
  loadTokens,
  saveTokens,
  STORAGE_KEYS,
  tail,
  type StoredTokens,
} from "@/lib/tokens";

function DecodedToken({ label, token }: { label: string; token: string }) {
  let content: string;
  try {
    const { header, payload } = decodeJwt(token);
    content = JSON.stringify({ header, payload }, null, 2);
  } catch (error) {
    content = `Could not decode: ${error instanceof Error ? error.message : String(error)}`;
  }
  return (
    <details>
      <summary>
        {label} <span className="muted">(shown as …{tail(token)} — decoded, NOT verified)</span>
      </summary>
      <pre>{content}</pre>
    </details>
  );
}

export default function HomePage() {
  const [tokens, setTokens] = useState<StoredTokens | null>(null);
  const [nowTs, setNowTs] = useState<number>(0);
  const [apiResult, setApiResult] = useState<{ label: string; result: ApiResult } | null>(null);
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    setTokens(loadTokens());
    setNowTs(Date.now());
  }, []);

  // Live countdown to access-token expiry.
  useEffect(() => {
    const id = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const remainingSeconds = tokens ? Math.max(0, Math.floor((tokens.expiresAt - nowTs) / 1000)) : null;
  const isExpired = remainingSeconds !== null && remainingSeconds <= 0;

  const handleLogin = useCallback(async () => {
    const verifier = createVerifier();
    const state = createState();
    const challenge = await createChallenge(verifier);

    sessionStorage.setItem(STORAGE_KEYS.verifier, verifier);
    sessionStorage.setItem(STORAGE_KEYS.state, state);
    sessionStorage.removeItem(STORAGE_KEYS.codeConsumed);

    const url = await buildAuthorizationUrl(state, challenge);
    window.location.assign(url);
  }, []);

  const handleCall = useCallback(
    async (path: string) => {
      const result = await callApi(path, tokens?.accessToken);
      setApiResult({ label: path, result });
    },
    [tokens],
  );

  const handleRefresh = useCallback(async () => {
    if (!tokens?.refreshToken) {
      setMessage("No refresh token available.");
      return;
    }
    const oldTail = tail(tokens.accessToken);
    try {
      const data = await refreshTokens(tokens.refreshToken);
      const updated = toStoredTokens(data);
      setTokens(updated);
      saveTokens(updated);
      const newTail = tail(updated.accessToken);
      setMessage(
        `Refreshed. access token …${oldTail} → …${newTail} ` +
          `(${oldTail === newTail ? "UNCHANGED — unexpected" : "changed, proof it is a new token"}).`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      clearTokens();
      setTokens(null);
      setMessage(`Refresh failed: ${detail}. Tokens cleared — please log in again.`);
    }
  }, [tokens]);

  const handleLogout = useCallback(async () => {
    const idToken = tokens?.idToken ?? null;
    const url = await buildLogoutUrl(idToken);
    clearTokens();
    clearFlow();
    setTokens(null);
    setApiResult(null);
    window.location.assign(url);
  }, [tokens]);

  return (
    <main>
      <h1>Keycloak Auth Lab — Next.js frontend</h1>
      <p className="muted">
        Authorization Code + PKCE, implemented by hand with the Web Crypto API. No auth libraries.
        Backend: {config.apiBaseUrl}
      </p>

      <section>
        <h2>Session</h2>
        {!tokens ? (
          <>
            <p className="status-401">Not logged in.</p>
            <button onClick={handleLogin}>Login with Keycloak</button>
          </>
        ) : (
          <>
            <p className="status-200">Logged in.</p>
            <p>
              Access token expires in:{" "}
              {isExpired ? (
                <span className="expired">expired</span>
              ) : (
                <strong>{remainingSeconds}s</strong>
              )}
            </p>
            <button onClick={() => handleCall("/profile")}>Call /profile</button>
            <button onClick={handleRefresh}>Refresh token</button>
            <button onClick={handleLogout}>Logout</button>
          </>
        )}
      </section>

      {message && (
        <section>
          <strong>Status:</strong> {message}
        </section>
      )}

      <section>
        <h2>API calls</h2>
        <p className="muted">
          Every call shows the HTTP status and the raw response body. The /profile button keeps
          working after the token expires so you can see a 401.
        </p>
        <div>
          <button onClick={() => handleCall("/public")}>Call /public</button>
          <button onClick={() => handleCall("/profile")}>Call /profile</button>
          <button onClick={() => handleCall("/admin")}>Call /admin</button>
        </div>
        {apiResult && (
          <div>
            <p>
              <strong>{apiResult.label}</strong> →{" "}
              <span className={statusClass(apiResult.result.status)}>
                {apiResult.result.status === 0 ? "no response" : apiResult.result.status}
              </span>
            </p>
            <pre>{apiResult.result.body}</pre>
          </div>
        )}
      </section>

      {tokens && (
        <section>
          <h2>Tokens</h2>
          <p className="muted">
            Decoded below for reading only — this is <strong>NOT</strong> verification. Only the
            backend checks the signature, issuer, audience and expiry.
          </p>
          <DecodedToken label="Access token" token={tokens.accessToken} />
          {tokens.idToken && <DecodedToken label="ID token" token={tokens.idToken} />}
          {tokens.refreshToken && <DecodedToken label="Refresh token" token={tokens.refreshToken} />}
        </section>
      )}
    </main>
  );
}
