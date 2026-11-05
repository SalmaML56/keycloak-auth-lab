// Run the RFC 7636 Appendix B test vector against the SAME helper the app uses
// (lib/pkce.ts). If this passes, the login button's PKCE challenge is correct.
//
//   npm run test:pkce

import { createChallenge, createVerifier } from "../lib/pkce";

const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const expectedChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

async function main(): Promise<void> {
  const actualChallenge = await createChallenge(verifier);

  console.log("verifier          :", verifier);
  console.log("computed challenge:", actualChallenge);
  console.log("expected challenge:", expectedChallenge);

  const generated = createVerifier();
  const lengthOk = generated.length >= 43 && generated.length <= 128;
  console.log(
    `createVerifier()  : length ${generated.length} (RFC 7636 requires 43..128) -> ${lengthOk ? "OK" : "FAIL"}`,
  );

  if (actualChallenge !== expectedChallenge) {
    console.error("\nFAIL: challenge does not match the RFC 7636 test vector.");
    process.exit(1);
  }
  if (!lengthOk) {
    console.error("\nFAIL: createVerifier() length out of range.");
    process.exit(1);
  }

  console.log("\nPASS: PKCE S256 matches the RFC 7636 test vector and verifier length is valid.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
