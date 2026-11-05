// OAuth 2.0 / OIDC calls. Endpoints are read from Keycloak's discovery
// (well-known) document, memoised so we fetch it once per page load, and
// derived from lib/config.ts as a fallback.

import { config, realmBaseUrl } from "./config";
import { STORAGE_KEYS, type StoredTokens } from "./tokens";

export type Endpoints = {
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint: string;
};

export const wellKnownUrl = `${realmBaseUrl}/.well-known/openid-configuration`;

const fallbackEndpoints: Endpoints = {
  authorization_endpoint: `${realmBaseUrl}/protocol/openid-connect/auth`,
  token_endpoint: `${realmBaseUrl}/protocol/openid-connect/token`,
  end_session_endpoint: `${realmBaseUrl}/protocol/openid-connect/logout`,
};

let endpointsPromise: Promise<Endpoints> | null = null;

/** Read the well-known document once; memoise the endpoints for the page. */
export function getEndpoints(): Promise<Endpoints> {
  if (!endpointsPromise) {
    endpointsPromise = fetch(wellKnownUrl)
      .then(async (response) => {
        if (!response.ok) throw new Error(`well-known returned ${response.status}`);
        const doc = await response.json();
        return {
          authorization_endpoint: doc.authorization_endpoint,
          token_endpoint: doc.token_endpoint,
          end_session_endpoint: doc.end_session_endpoint,
        } satisfies Endpoints;
      })
      .catch(() => fallbackEndpoints); // offline build / unreachable IdP
  }
  return endpointsPromise;
}

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
};

export function toStoredTokens(data: TokenResponse): StoredTokens {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    idToken: data.id_token ?? null,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

const SCOPE = "openid profile email";

/** Build the Authorization Code + PKCE URL for the login button. */
export async function buildAuthorizationUrl(state: string, challenge: string): Promise<string> {
  const endpoints = await getEndpoints();
  const url = new URL(endpoints.authorization_endpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const endpoints = await getEndpoints();
  const response = await fetch(endpoints.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json();
  if (!response.ok) {
    const detail = data.error_description || data.error || `token endpoint returned ${response.status}`;
    throw new Error(detail);
  }
  return data as TokenResponse;
}

/** Exchange the authorization code. The code_verifier proves the PKCE pair. */
export function exchangeCode(code: string, verifier: string): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
    }),
  );
}

/** Use the refresh token to get a new access token. */
export function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      refresh_token: refreshToken,
    }),
  );
}

/** Build the RP-initiated logout URL (id_token_hint + post-logout redirect). */
export async function buildLogoutUrl(idToken: string | null): Promise<string> {
  const endpoints = await getEndpoints();
  const url = new URL(endpoints.end_session_endpoint);
  if (idToken) url.searchParams.set("id_token_hint", idToken);
  url.searchParams.set("post_logout_redirect_uri", config.postLogoutRedirectUri);
  return url.toString();
}

export { STORAGE_KEYS };
