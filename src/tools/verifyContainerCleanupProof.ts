/**
 * verifyContainerCleanupProof — S-16. Proves the cleanup predicate against a
 * REAL container runtime, because mocks cannot establish that the shapes a real
 * daemon produces are the shapes the predicate was written for.
 *
 * The unit suite proves `containerRemovalProven` over synthetic and
 * node-generated `spawnSync` results. That is necessary and not sufficient: the
 * defect this milestone repairs was precisely a wrong belief about what a real
 * `docker inspect` returns. So this tool drives the SAME predicate with results
 * produced by an actual daemon:
 *
 *   1. a container that really exists   -> inspect exits 0     -> NOT removed
 *   2. that same container, removed     -> inspect exits != 0  -> removed
 *   3. the runtime cannot be executed   -> no exit code        -> NOT removed
 *   4. a real docker call that times out -> no exit code       -> NOT removed
 *
 * Cases 3 and 4 are the security-relevant ones: before S-16 both reported
 * REMOVED, which is how a live container could be recorded as cleanly gone.
 *
 * It prints a SAFE receipt only — booleans and a verdict. Never container
 * stdout, never a host path, never an environment value. Exit 0 when every
 * expectation holds, 1 otherwise, so CI fails loudly rather than recording an
 * unproven repair as fine.
 *
 * CI-only: it requires a working runtime and is deliberately NOT part of the P0
 * suite, which must pass on hosts that have no container runtime at all.
 *
 * Usage: node dist/tools/verifyContainerCleanupProof.js
 */

import { spawnSync } from "child_process";
import { containerRemovalProven, approvedImageReference, PROBE_HELPER_TIMEOUT_MS, PROBE_KILL_SIGNAL } from "../cognitive/containerSandboxBackend";
import { resolveTrustedExecutable } from "../cognitive/trustedExecutableRegistry";

/** One bounded runtime call, killed uncatchably, exactly as the backend does. */
function run(command: string, args: readonly string[], timeoutMs = PROBE_HELPER_TIMEOUT_MS) {
  return spawnSync(command, [...args], { shell: false, encoding: "utf8", timeout: timeoutMs, killSignal: PROBE_KILL_SIGNAL, maxBuffer: 65536, windowsHide: true });
}

function main(): void {
  const checks: { readonly name: string; readonly passed: boolean }[] = [];
  const record = (name: string, passed: boolean): void => {
    checks.push({ name, passed });
  };

  const resolved = resolveTrustedExecutable("docker", { workspaceRoots: [] });
  if (!resolved.ok || !resolved.value.executionAuthorized) {
    console.error("S-16 real-container proof: docker is not resolvable/authorized on this host.");
    process.exit(1);
    return;
  }
  const docker = resolved.value.command;
  const name = `namla-s16-cleanup-${process.pid}`;

  try {
    // ---- 1. a container that REALLY EXISTS must not read as removed --------
    // Detached and long-lived, so `inspect` has something real to describe.
    const started = run(docker, ["run", "-d", "--name", name, "--network", "none", "--entrypoint", "sleep", approvedImageReference(), "120"]);
    record("container started for the proof", started.status === 0);

    const present = run(docker, ["inspect", name]);
    record("a real existing container: inspect exits 0", present.status === 0);
    record("a real existing container is NOT reported removed", containerRemovalProven(present) === false);

    // ---- 2. after a real removal, absence is provable ----------------------
    const removedOk = run(docker, ["rm", "-f", name]);
    record("container removal command succeeded", removedOk.status === 0);

    const absent = run(docker, ["inspect", name]);
    record("a really-removed container: inspect exits non-zero", typeof absent.status === "number" && absent.status !== 0);
    record("a really-removed container IS reported removed", containerRemovalProven(absent) === true);

    // ---- 3. the runtime itself cannot run: nothing was observed ------------
    const unrunnable = run("namla-s16-no-such-runtime", ["inspect", name]);
    record("an unrunnable runtime yields no exit code", unrunnable.status === null);
    record("an unrunnable runtime is NOT reported removed", containerRemovalProven(unrunnable) === false);

    // ---- 4. a REAL docker call that times out ------------------------------
    // `docker events` blocks waiting for events, so this is a genuine timeout
    // of the real binary. It creates nothing and leaves nothing behind.
    const timedOut = run(docker, ["events"], 1500);
    record("a real docker call really timed out", timedOut.status === null);
    record("a timed-out real inspect is NOT reported removed", containerRemovalProven(timedOut) === false);
  } finally {
    // Always clean up, whatever happened above.
    run(docker, ["rm", "-f", name]);
  }

  // ---- 5. nothing survived ------------------------------------------------
  const survivors = run(docker, ["ps", "-aq", "--filter", `name=${name}`]);
  record("no proof container survived", survivors.status === 0 && (survivors.stdout ?? "").trim().length === 0);

  const failed = checks.filter((c) => !c.passed);
  console.log(JSON.stringify({ tool: "verifyContainerCleanupProof", platform: process.platform, total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));

  if (failed.length > 0) {
    console.error(`\nS-16 REAL-CONTAINER PROOF FAILED: ${failed.map((c) => c.name).join("; ")}`);
    process.exit(1);
  }
  console.error("\nS-16 REAL-CONTAINER PROOF PASSED: unknown inspect outcomes are never reported as removal.");
  process.exit(0);
}

main();
