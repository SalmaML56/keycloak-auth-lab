// Build the authorization URL exactly the way the login button does
// (lib/oauth.ts) and open it with `curl -i`. A 200 or 302 means Keycloak
// accepted client_id, redirect_uri and the PKCE parameters; an error page
// would come back as a 400/500.
//
//   npm run check:auth-url

import { execFileSync } from "node:child_process";
import { buildAuthorizationUrl, wellKnownUrl } from "../lib/oauth";

const state = "automated-check-state";
// A syntactically valid S256 challenge (43 chars); its value is irrelevant here.
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

async function main(): Promise<void> {
  const url = await buildAuthorizationUrl(state, challenge);
  console.log("well-known:", wellKnownUrl);
  console.log("authorization URL:", url);

  const output = execFileSync("curl", ["-i", "-s", url], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });

  const statusLine = output.split(/\r?\n/)[0].trim();
  const status = Number((statusLine.match(/ (\d{3})\b/) ?? [])[1] ?? 0);
  console.log("curl -i status line:", statusLine);

  const locationMatch = output.match(/^location:\s*(.+)$/im);
  if (locationMatch) {
    try {
      const location = new URL(locationMatch[1].trim());
      // Print only the path and parameter NAMES — never session values.
      console.log("redirect path:", location.pathname);
      console.log("redirect params:", [...location.searchParams.keys()].join(", "));
    } catch {
      console.log("redirect Location: (unparseable)");
    }
  }

  const isErrorPage = /invalid_request|invalid_client|"error"|<title>Error/i.test(output);

  if ((status === 200 || status === 302) && !isErrorPage) {
    console.log(`\nPASS: authorization URL accepted by Keycloak (HTTP ${status}, no OAuth error page).`);
    return;
  }

  console.error(`\nFAIL: expected HTTP 200/302 with no error page, got ${status}.`);
  console.error("First 400 chars of response:\n", output.slice(0, 400));
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
