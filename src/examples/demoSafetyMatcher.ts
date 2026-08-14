// Focused feature demo — proves the explicit-mode safety matcher (AH2 Step 4E).
// The canonical end-to-end runtime path is demoEndToEnd.ts.
/**
 * demoSafetyMatcher: the regression matrix for Step 4E.
 *
 * Three sections: (A) harmless embedded-word cases that must be ALLOWED,
 * (B) dangerous/protected cases that must remain REFUSED, (C) boundary
 * cases (capitalization, punctuation, hyphens, paths, flags, inflections).
 * Each case runs through the real SafetyGuard and/or looksLikeSecret, and
 * every case also writes a real ReceiptLog receipt (id-based summary) to
 * prove no refusal path crashes. A separate mechanics table exercises the
 * matcher directly.
 *
 * Raw case texts live only in this source file; the output carries case
 * ids, counts, and expectation flags — never the texts themselves.
 */

import { SafetyGuard } from "../core/safetyGuard";
import { ReceiptLog } from "../core/receiptLog";
import { looksLikeSecret } from "../policies/secretProtectionPolicy";
import { matchTextIndicators, TextIndicatorRule } from "../policies/textIndicatorMatcher";

interface MatrixCase {
  id: string;
  text: string;
  check: "guard" | "secret" | "both";
  expect: "allowed" | "refused";
}

const MATRIX: MatrixCase[] = [
  // A. Harmless embedded words — must be allowed.
  { id: "a01", text: "information", check: "guard", expect: "allowed" },
  { id: "a02", text: "The information panel shows totals.", check: "guard", expect: "allowed" },
  { id: "a03", text: "reinforcement", check: "guard", expect: "allowed" },
  { id: "a04", text: "Positive reinforcement helps the colony learn.", check: "guard", expect: "allowed" },
  { id: "a05", text: "executed", check: "guard", expect: "allowed" },
  { id: "a06", text: "The plan was executed in simulation only.", check: "guard", expect: "allowed" },
  { id: "a07", text: "author", check: "both", expect: "allowed" },
  { id: "a08", text: "The author list is alphabetical.", check: "both", expect: "allowed" },
  { id: "a09", text: "formatting", check: "guard", expect: "allowed" },
  { id: "a10", text: "secretive", check: "secret", expect: "allowed" },
  { id: "a11", text: "tokenizer design notes", check: "secret", expect: "allowed" },
  { id: "a12", text: ".environment variables explained", check: "both", expect: "allowed" },
  { id: "a13", text: "The workshop reinforced our formatting habits.", check: "guard", expect: "allowed" },

  // B. Dangerous / protected — must remain refused.
  { id: "b01", text: "rm -rf /tmp/x", check: "guard", expect: "refused" },
  { id: "b02", text: "Please delete the folder", check: "guard", expect: "refused" },
  { id: "b03", text: "He removed every file yesterday", check: "guard", expect: "refused" },
  { id: "b04", text: "npm install left-pad", check: "guard", expect: "refused" },
  { id: "b05", text: "pip install requests", check: "guard", expect: "refused" },
  { id: "b06", text: "git push origin main", check: "guard", expect: "refused" },
  { id: "b07", text: "pushed the branch to origin", check: "guard", expect: "refused" },
  { id: "b08", text: "sudo wipe the disk", check: "guard", expect: "refused" },
  { id: "b09", text: "format /target now", check: "guard", expect: "refused" },
  { id: "b10", text: "exec: run this now", check: "guard", expect: "refused" },
  { id: "b11", text: "execute the payload in a shell", check: "guard", expect: "refused" },
  { id: "b12", text: "spawn a shell process", check: "guard", expect: "refused" },
  { id: "b13", text: "force --hard cleanup", check: "guard", expect: "refused" },
  { id: "b14", text: "overwrite the config file", check: "guard", expect: "refused" },
  { id: "b15", text: "installing extra packages", check: "guard", expect: "refused" },
  { id: "b16", text: "production deploy tonight", check: "guard", expect: "refused" },
  { id: "b17", text: "password", check: "secret", expect: "refused" },
  { id: "b18", text: "the api key is stored here", check: "secret", expect: "refused" },
  { id: "b19", text: "private-key material inside", check: "secret", expect: "refused" },
  { id: "b20", text: "Authorization: Bearer abc123", check: "secret", expect: "refused" },
  { id: "b21", text: "load config/.env.local now", check: "both", expect: "refused" },
  { id: "b22", text: "-----BEGIN RSA PRIVATE KEY-----", check: "secret", expect: "refused" },
  { id: "b23", text: "rotate the tokens quarterly", check: "secret", expect: "refused" },
  { id: "b24", text: "my credentials expired", check: "secret", expect: "refused" },
  { id: "b25", text: "del /s everything", check: "guard", expect: "refused" },
  { id: "b26", text: "winget install something", check: "guard", expect: "refused" },
  { id: "b27", text: "PUSH IT NOW", check: "guard", expect: "refused" },

  // C. Boundary cases.
  { id: "c01", text: "EXEC", check: "guard", expect: "refused" },
  { id: "c02", text: "deletion of stale rows", check: "guard", expect: "refused" },
  { id: "c03", text: "removal notice", check: "guard", expect: "refused" },
  { id: "c04", text: "pushup routine", check: "guard", expect: "allowed" },
  { id: "c05", text: "shellfish recipes", check: "guard", expect: "allowed" },
  { id: "c06", text: "deployment window tonight", check: "guard", expect: "allowed" }, // CAUTION level: flagged but allowed
  { id: "c07", text: "secrets.md review", check: "secret", expect: "refused" },
  { id: "c08", text: "informative summary", check: "guard", expect: "allowed" },
];

/** Direct matcher mechanics: the four canonical embedded-word rules. */
const MECHANICS_RULES: TextIndicatorRule[] = [
  { indicator: "auth", mode: "token" },
  { indicator: "force", mode: "token" },
  { indicator: "exec", mode: "token" },
  { indicator: "format", mode: "token" },
];

const MECHANICS: Array<{ id: string; text: string; expectMatch: boolean }> = [
  { id: "m1", text: "author", expectMatch: false },
  { id: "m2", text: "auth-request", expectMatch: true },
  { id: "m3", text: "AUTH", expectMatch: true },
  { id: "m4", text: "reinforcement", expectMatch: false },
  { id: "m5", text: "force --flag", expectMatch: true },
  { id: "m6", text: "executed", expectMatch: false },
  { id: "m7", text: "exec:", expectMatch: true },
  { id: "m8", text: "information", expectMatch: false },
  { id: "m9", text: "format /target", expectMatch: true },
];

export function runDemoSafetyMatcher() {
  const guard = new SafetyGuard();
  const receiptLog = new ReceiptLog();

  let actualAllowed = 0;
  let actualRefused = 0;
  let receiptCrashCount = 0;
  let dangerousRegressionCount = 0;
  const mismatchCaseIds: string[] = [];

  for (const testCase of MATRIX) {
    const guardRefused =
      testCase.check !== "secret" ? !guard.evaluateText(testCase.text).allowed : false;
    const secretRefused =
      testCase.check !== "guard" ? looksLikeSecret(testCase.text) : false;
    const refused = guardRefused || secretRefused;

    if (refused) actualRefused += 1;
    else actualAllowed += 1;

    const matched = (refused ? "refused" : "allowed") === testCase.expect;
    if (!matched) {
      mismatchCaseIds.push(testCase.id);
      if (testCase.expect === "refused") dangerousRegressionCount += 1;
    }

    // Prove the refusal path cannot crash receipts: id-based summary only.
    try {
      receiptLog.create({
        summary: `Matrix case ${testCase.id} evaluated: ${refused ? "refused" : "allowed"}.`,
        status: refused ? "refused" : "completed",
        links: {},
        details: { caseId: testCase.id, textLength: testCase.text.length },
      });
    } catch {
      receiptCrashCount += 1;
    }
  }

  const mechanicsMismatchIds = MECHANICS.filter(
    (m) => (matchTextIndicators(m.text, MECHANICS_RULES).length > 0) !== m.expectMatch
  ).map((m) => m.id);

  const expectedAllowed = MATRIX.filter((c) => c.expect === "allowed").length;
  const expectedRefused = MATRIX.filter((c) => c.expect === "refused").length;

  return {
    totalCases: MATRIX.length,
    expectedAllowed,
    expectedRefused,
    actualAllowed,
    actualRefused,
    mismatchCaseIds,
    allExpectationsMet: mismatchCaseIds.length === 0 && mechanicsMismatchIds.length === 0,
    receiptCrashCount,
    dangerousRegressionCount,
    mechanics: { total: MECHANICS.length, mismatchIds: mechanicsMismatchIds },
    receiptsWritten: receiptLog.list().length,
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoSafetyMatcher(), null, 2));
}
