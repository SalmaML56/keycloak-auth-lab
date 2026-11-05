// All environment-specific values live here and are read from NEXT_PUBLIC_*
// variables. Components never hardcode URLs — they import this module.

export const config = {
  keycloakUrl: process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? "http://localhost:8080",
  realm: process.env.NEXT_PUBLIC_KEYCLOAK_REALM ?? "demo-realm",
  clientId: process.env.NEXT_PUBLIC_CLIENT_ID ?? "nextjs-app",
  redirectUri: process.env.NEXT_PUBLIC_REDIRECT_URI ?? "http://localhost:3000/callback",
  postLogoutRedirectUri:
    process.env.NEXT_PUBLIC_POST_LOGOUT_REDIRECT_URI ?? "http://localhost:3000",
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000",
} as const;

export const realmBaseUrl = `${config.keycloakUrl}/realms/${config.realm}`;
