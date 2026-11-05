// Dev helper: print a fresh PKCE pair plus the authorization URL that the
// login button would build. Used by scripts/e2e_login_check.sh.

import { buildAuthorizationUrl } from "../lib/oauth";
import { createChallenge, createState, createVerifier } from "../lib/pkce";

async function main(): Promise<void> {
  const verifier = createVerifier();
  const challenge = await createChallenge(verifier);
  const state = createState();
  const authorizationUrl = await buildAuthorizationUrl(state, challenge);
  console.log(JSON.stringify({ verifier, state, authorizationUrl }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
