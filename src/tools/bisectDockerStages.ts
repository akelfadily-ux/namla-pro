/**
 * bisectDockerStages — CI-ONLY entry point for the stage bisection.
 *
 * Runs only when the main verification returned exit 125 (Docker refused the
 * invocation). It re-applies the flags in eight cumulative stages under the
 * approved image and reports the FIRST stage Docker rejects, which brackets the
 * offending flag to one small group.
 *
 * Emits the safe stage result only. Never raw stdout/stderr, host paths,
 * usernames, container names or ids, environment values, or secrets.
 *
 * Usage: node dist/tools/bisectDockerStages.js [--out <file>]
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { resolveTrustedExecutable } from "../cognitive/trustedExecutableRegistry";
import { DockerStageRunner, runStageBisection, describeStageResult } from "../cognitive/dockerStageBisection";
import { validateMountSourceSet } from "../cognitive/safeMountSource";

/**
 * The bisection is ONLY meaningful for exit 125 - Docker refusing the
 * invocation. Any other outcome means the container actually started, so the
 * fault is not in the argument list and re-running eight variants would just
 * produce noise. The gate is enforced HERE rather than only in the workflow
 * expression, so it is deterministic and testable.
 */
function shouldBisect(capabilityPath: string): { readonly run: boolean; readonly reason: string } {
  if (!existsSync(capabilityPath)) return { run: false, reason: "no capability report to read" };
  try {
    const report = JSON.parse(readFileSync(capabilityPath, "utf8")) as { startupDiagnostics?: { runtimeExitCode?: number | null } };
    const code = report.startupDiagnostics?.runtimeExitCode ?? null;
    if (code === 125) return { run: true, reason: "exit 125 - docker refused the invocation" };
    return { run: false, reason: `exit ${String(code)} is not 125` };
  } catch {
    return { run: false, reason: "capability report was not parseable" };
  }
}

function main(): void {
  const outIndex = process.argv.indexOf("--out");
  const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : "";
  const capIndex = process.argv.indexOf("--capability");
  const capabilityPath = capIndex >= 0 ? process.argv[capIndex + 1] : "container-sandbox-capability.json";

  const gate = shouldBisect(resolve(capabilityPath));
  if (!gate.run) {
    const payload = { skipped: true, safeReasonCode: "bisection-not-applicable", platform: process.platform };
    const json = JSON.stringify(payload, null, 2);
    if (outPath) writeFileSync(resolve(outPath), json, "utf8");
    console.log(json);
    console.error(`
BISECTION SKIPPED: ${gate.reason}`);
    process.exit(0);
  }

  const resolved = resolveTrustedExecutable("docker", {});
  if (!resolved.ok) {
    const payload = { available: false, safeReasonCode: "sandbox-runtime-unavailable", platform: process.platform };
    const json = JSON.stringify(payload, null, 2);
    if (outPath) writeFileSync(resolve(outPath), json, "utf8");
    console.log(json);
    console.error("\nDOCKER NOT AVAILABLE - bisection skipped (this is a report, not a pass).");
    process.exit(0);
  }

  // The ONLY writable mount used by the bisection.
  const workspace = mkdtempSync(resolve(tmpdir(), "namla-bisect-ws-"));
  let result;
  try {
    // §31: prove both bind-mount sources before any Docker argv is built. A
    // refusal is reported as a safe reason code — never the offending path.
    const mounts = validateMountSourceSet({
      workspace,
      readOnlySource: null,
      probe: resolve(process.cwd(), "dist", "tools"),
      workspaceRoots: [workspace],
      probeRoots: [process.cwd()],
    });
    // `probe` is optional in the shared validator, but stage 8 REQUIRES it, so
    // a null here is refused explicitly rather than cast away.
    if (!mounts.ok || mounts.sources.probe === null) {
      const reason = mounts.ok ? "sandbox-mount-source-missing" : mounts.reasonCode;
      const payload = { skipped: true, safeReasonCode: reason, platform: process.platform };
      const json = JSON.stringify(payload, null, 2);
      if (outPath) writeFileSync(resolve(outPath), json, "utf8");
      console.log(json);
      console.error(`\nBISECTION SKIPPED: a bind-mount source could not be proven (${reason})`);
      process.exit(0);
    }
    result = runStageBisection(new DockerStageRunner(resolved.value.command), { workspaceHostPath: mounts.sources.workspace, probeHostDir: mounts.sources.probe, sourceHostPath: null });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }

  const json = JSON.stringify({ ...result, platform: process.platform, commitSha: (process.env.GITHUB_SHA ?? "local").slice(0, 40) }, null, 2);
  if (outPath) writeFileSync(resolve(outPath), json, "utf8");
  console.log(json);
  console.error(`\nSTAGE BISECTION: ${describeStageResult(result)}`);

  // A report, not a gate: the verification job has already failed. Exiting
  // nonzero here would only mask which stage was identified.
  process.exit(0);
}

main();
