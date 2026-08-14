/**
 * workflowSourceTests — deterministic checks on the workflow SOURCE.
 *
 * These exist because a workflow can be rejected before a single job is
 * created, and that failure mode is uniquely bad: the run goes red with zero
 * jobs, zero check-runs and zero artifacts, so every previously-green job
 * silently stops running and there is no per-job result to read. That is
 * exactly what happened on fe702ff, where one plain YAML scalar containing
 * ": " took the whole matrix down.
 *
 * A YAML parser is not installed here, so rather than pretend to validate the
 * whole document these tests assert the specific, checkable properties that
 * have actually broken or that must never regress: the offending construct,
 * the presence of every expected job, and the security posture of the file.
 *
 * Pure text inspection. No workflow is executed, no network, no provider.
 *
 * Run: node --test dist/tools/workflowSourceTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const WORKFLOW_RELATIVE = ".github/workflows/p0-security.yml";

/** Locate the workflow from the repo root, whether run from root or dist. */
function workflowPath(): string {
  const candidates = [resolve(process.cwd(), WORKFLOW_RELATIVE), resolve(__dirname, "..", "..", WORKFLOW_RELATIVE), resolve(__dirname, "..", "..", "..", WORKFLOW_RELATIVE)];
  const found = candidates.find(existsSync);
  assert.equal(typeof found, "string", "the P0 security workflow must exist");
  return found as string;
}

function workflowLines(): string[] {
  return readFileSync(workflowPath(), "utf8").split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
}

/**
 * Plain (unquoted) YAML scalars that contain ": ". A plain scalar may not,
 * because colon-space is the mapping indicator.
 */
function unsafePlainScalars(lines: readonly string[]): Array<{ line: number; key: string; value: string }> {
  const out: Array<{ line: number; key: string; value: string }> = [];
  lines.forEach((l, i) => {
    const m = /^(\s*)(run|name|if|shell|uses|path):\s+(.*)$/.exec(l);
    if (!m) return;
    const value = m[3];
    if (value.length === 0) return;
    if (value.startsWith("|") || value.startsWith(">")) return; // block scalar
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted) return;
    if (value.includes(": ")) out.push({ line: i + 1, key: m[2], value });
  });
  return out;
}

// --------------------------------------------------------- THE PARSE DEFECT ---

test("NO plain run/name scalar contains an unquoted colon-space", () => {
  const offenders = unsafePlainScalars(workflowLines());
  const detail = offenders.map((o) => `line ${o.line} [${o.key}]: ${o.value}`).join("; ");
  assert.equal(offenders.length, 0, `a plain YAML scalar containing ": " rejects the ENTIRE workflow and creates zero jobs. Offenders: ${detail}`);
});

test("the container image-inspect command uses a block scalar", () => {
  const lines = workflowLines();
  const idx = lines.findIndex((l) => l.includes("docker image inspect") && l.includes("--format"));
  assert.equal(idx >= 0, true, "the image-inspect command must be present");

  // The command must sit INSIDE a block scalar, not on the `run:` line itself.
  const commandLine = lines[idx];
  assert.equal(/^\s*run:/.test(commandLine), false, "the command must not be a plain run: scalar");

  // Walk back to the owning `run:` and require it to open a block scalar.
  let owner = -1;
  for (let i = idx - 1; i >= 0 && i > idx - 8; i -= 1) {
    if (/^\s*run:\s*(\||>)/.test(lines[i])) {
      owner = i;
      break;
    }
    if (/^\s*-\s+name:/.test(lines[i])) break; // reached the step header first
  }
  assert.equal(owner >= 0, true, "the image-inspect command must be inside a `run: |` block scalar");
  assert.equal(commandLine.includes("image present: "), true, "the colon-space that caused the failure is still exercised");
});

// ------------------------------------------------------------ JOB INVENTORY ---

test("every expected job is present and none was silently removed", () => {
  const lines = workflowLines();
  const jobKeys = lines.filter((l) => /^  [A-Za-z0-9_-]+:$/.test(l)).map((l) => l.trim().replace(":", ""));

  for (const required of ["p0-security", "sandbox-capability", "real-container-sandbox"]) {
    assert.equal(jobKeys.includes(required), true, `job ${required} must be present - a silently removed job stops testing without failing`);
  }
  // Exact set, so an addition is a deliberate decision rather than a surprise.
  const expected = ["p0-security", "sandbox-capability", "real-container-sandbox"].sort();
  const actual = jobKeys.filter((k) => expected.includes(k)).sort();
  assert.deepEqual(actual, expected);
});

test("the matrix still covers Windows, Linux and macOS", () => {
  const text = workflowLines().join("\n");
  for (const os of ["windows-latest", "ubuntu-latest", "macos-latest"]) {
    assert.equal(text.includes(os), true, `the matrix must still include ${os}`);
  }
});

// -------------------------------------------------------------- SECURITY ---

test("the workflow requires no secrets and grants no write permission", () => {
  const lines = workflowLines();
  const text = lines.join("\n");

  // No repository secret is referenced anywhere.
  assert.equal(/\$\{\{\s*secrets\./.test(text), false, "the workflow must never reference a repository secret");

  // Permissions are read-only.
  const permIndex = lines.findIndex((l) => /^permissions:/.test(l));
  assert.equal(permIndex >= 0, true, "an explicit permissions block is required");
  const permBlock = lines.slice(permIndex + 1, permIndex + 6).filter((l) => /^\s+\S/.test(l));
  assert.equal(permBlock.some((l) => /contents:\s*read/.test(l)), true, "contents must be read-only");
  assert.equal(permBlock.some((l) => /write/.test(l)), false, "no write permission may be granted");

  // Checkout must not persist a credential a later step could reuse.
  assert.equal(text.includes("persist-credentials: false"), true, "checkout must not persist credentials");
});

test("no job pushes, and the container job never pulls an image", () => {
  // Comment lines are excluded: the header documents "no git push" as a RULE,
  // and matching that prose would assert against the documentation rather than
  // against any executable step.
  const executable = workflowLines().filter((l) => !/^\s*#/.test(l));
  const text = executable.join("\n");
  assert.equal(/git\s+push/.test(text), false, "no executable workflow step may push");
  assert.equal(/docker\s+pull/.test(text), false, "the sandbox image is BUILT locally and never pulled");
  assert.equal(text.includes("docker build -f sandbox/Dockerfile"), true, "the approved image must be built locally");
});

test("detection is never recorded as verification in the container job", () => {
  const text = workflowLines().join("\n");
  // The container job must require BOTH the verified state and the probe as the
  // source of that state.
  assert.equal(text.includes("available-and-verified"), true);
  assert.equal(text.includes("isolation-probe"), true, "the job must assert the verdict came from the probe, not from detection");

  // The sandbox-capability job enforces `namlaSandboxVerified === false` through
  // validateCapabilityReport rather than an inline script, so assert the
  // validator is actually invoked - that is where the guarantee now lives.
  assert.equal(text.includes("validateCapabilityReport.js"), true, "the capability job must run the report validator");
  assert.equal(text.includes("sandboxCapabilityReport.js > sandbox-capability.json"), true, "capability detection must run node directly, not through npm (banner corrupts the JSON)");
});
