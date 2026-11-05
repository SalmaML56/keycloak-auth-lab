"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { exchangeCode, toStoredTokens } from "@/lib/oauth";
import { clearFlow, saveTokens, STORAGE_KEYS } from "@/lib/tokens";

export default function CallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // React Strict Mode mounts effects TWICE in development, and a fast refresh
  // can remount the component entirely. The authorization code is SINGLE-USE:
  // if we POST it to the token endpoint a second time Keycloak answers
  // `invalid_grant`, so the second run must be suppressed. We guard with a ref
  // (blocks the Strict Mode double-invoke within one mount) AND a
  // sessionStorage flag (blocks a full remount / manual reload).
  const alreadyRan = useRef(false);

  useEffect(() => {
    if (alreadyRan.current) return;
    alreadyRan.current = true;

    const params = new URLSearchParams(window.location.search);

    const oauthError = params.get("error");
    if (oauthError) {
      setError(`${oauthError}: ${params.get("error_description") ?? "(no description)"}`);
      return;
    }

    const code = params.get("code");
    const returnedState = params.get("state");
    const savedState = sessionStorage.getItem(STORAGE_KEYS.state);
    const verifier = sessionStorage.getItem(STORAGE_KEYS.verifier);

    // State is mandatory. Without it a callback could be a CSRF replay.
    if (!returnedState) {
      setError("Callback is missing the 'state' parameter — refusing to continue.");
      return;
    }
    if (!savedState || returnedState !== savedState) {
      setError("State mismatch — the callback does not match the login attempt that started it.");
      return;
    }
    if (!code) {
      setError("Callback is missing the 'code' parameter.");
      return;
    }
    if (!verifier) {
      setError("Missing PKCE code_verifier — did you start the login from this browser tab?");
      return;
    }

    // Second half of the single-use guard.
    if (sessionStorage.getItem(STORAGE_KEYS.codeConsumed) === "1") {
      setError(
        "This authorization code was already exchanged (Strict Mode / reload guard). Start a new login.",
      );
      return;
    }
    sessionStorage.setItem(STORAGE_KEYS.codeConsumed, "1");

    exchangeCode(code, verifier)
      .then((data) => {
        saveTokens(toStoredTokens(data));
        clearFlow();
        setDone(true);
        router.replace("/");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [router]);

  return (
    <main>
      <h1>Login callback</h1>
      {error && (
        <section>
          <p className="status-401">Login failed</p>
          <pre>{error}</pre>
          <Link href="/">← Back to start</Link>
        </section>
      )}
      {!error && !done && <p>Exchanging the authorization code for tokens…</p>}
    </main>
  );
}
