/**
 * validateCapabilityReport — proves the capability artifact is PURE JSON and
 * claims no verification it has not earned.
 *
 * The first real CI run failed here with `SyntaxError: Unexpected token '>'`
 * because the step used `npm run ... > file`: npm writes a banner to stdout
 * before the script's own output, so the redirected file began with npm text
 * rather than `{`. The workflow now runs node directly; this validator makes
 * that regression impossible to reintroduce silently.
 */

import { readFileSync } from "fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: validateCapabilityReport <file>");
  process.exit(1);
}

const raw = readFileSync(path, "utf8");
const failures: string[] = [];

// 1. PURE JSON: the very first non-whitespace character must be `{`. Anything
//    else means a banner or log line preceded it.
const trimmed = raw.trimStart();
if (!trimmed.startsWith("{")) {
  failures.push(`file does not begin with '{' — a banner or log line precedes the JSON (first 40 chars: ${JSON.stringify(raw.slice(0, 40))})`);
}
if (/^\s*>/m.test(raw.split("{")[0] ?? "")) {
  failures.push("an npm banner line ('>') precedes the JSON");
}

let report: Record<string, unknown> | null = null;
try {
  report = JSON.parse(raw) as Record<string, unknown>;
} catch (e) {
  failures.push(`file is not parseable JSON: ${(e as Error).name}`);
}

if (report) {
  // 2. Detection must NEVER claim Namla sandbox verification.
  if (report.namlaSandboxVerified !== false) {
    failures.push(`namlaSandboxVerified must be exactly false, got ${JSON.stringify(report.namlaSandboxVerified)}`);
  }
  // 3. Detection can only ever produce these two states.
  const state = report.capabilityState;
  if (state !== "available-unverified" && state !== "unavailable") {
    failures.push(`capabilityState must be available-unverified or unavailable, got ${JSON.stringify(state)}`);
  }
}

if (failures.length > 0) {
  console.error("CAPABILITY REPORT VALIDATION FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.error(`capability report OK: pure JSON, capabilityState=${String(report?.capabilityState)}, namlaSandboxVerified=false`);
