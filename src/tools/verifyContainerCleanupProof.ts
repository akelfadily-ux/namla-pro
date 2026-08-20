/**
 * verifyContainerCleanupProof — S-16. Proves the cleanup predicate against a
 * REAL container runtime, because mocks cannot establish that the shapes a real
 * daemon produces are the shapes the predicate was written for.
 *
 * The unit suite proves `containerAbsenceProven` over synthetic and
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
import { containerAbsenceProven, containerEnumerationArgs, approvedImageReference, PROBE_HELPER_TIMEOUT_MS, PROBE_KILL_SIGNAL } from "../cognitive/containerSandboxBackend";
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
    // ---- A. a container that REALLY EXISTS must not read as removed --------
    const started = run(docker, ["run", "-d", "--name", name, "--network", "none", "--entrypoint", "sleep", approvedImageReference(), "120"]);
    record("container started for the proof", started.status === 0);

    const present = run(docker, containerEnumerationArgs());
    record("A: a successful enumeration exits 0", present.status === 0);
    record("A: it lists the real container", (present.stdout ?? "").includes(name));
    record("A: a real existing container is NOT reported removed", containerAbsenceProven(name, present) === false);

    // ---- B. after a real removal, absence is provable ----------------------
    const removedOk = run(docker, ["rm", "-f", name]);
    record("container removal command succeeded", removedOk.status === 0);

    const absent = run(docker, containerEnumerationArgs());
    record("B: the enumeration still exits 0", absent.status === 0);
    record("B: the target no longer appears", !(absent.stdout ?? "").includes(name));
    record("B: a really-removed container IS reported removed", containerAbsenceProven(name, absent) === true);

    // ---- C. OPERATIONAL FAILURE against an unusable daemon endpoint --------
    // MANDATORY, and the evidence the first S-16 repair lacked. The real Docker
    // CLI runs normally and returns a numeric non-zero status it also returns
    // for "no such object" — so the two must not collapse. Only this ONE
    // invocation is pointed at a dead endpoint; the runner's daemon is never
    // touched, stopped, or reconfigured.
    const deadEndpoint = { ...process.env, DOCKER_HOST: "tcp://127.0.0.1:1" };
    const broken = spawnSync(docker, [...containerEnumerationArgs()], { shell: false, encoding: "utf8", timeout: PROBE_HELPER_TIMEOUT_MS, killSignal: PROBE_KILL_SIGNAL, maxBuffer: 65536, windowsHide: true, env: deadEndpoint });
    record("C: the CLI ran against a dead endpoint", broken.error === undefined || (broken.error as NodeJS.ErrnoException).code !== "ENOENT");
    record("C: it did NOT exit 0", broken.status !== 0);
    record("C: a daemon failure is NOT reported as removal", containerAbsenceProven(name, broken) === false);

    // The decisive comparison: B and C are different realities. Before the
    // correction both produced "removed"; now only B does.
    record("B and C no longer collapse into one verdict", containerAbsenceProven(name, absent) === true && containerAbsenceProven(name, broken) === false);

    // ---- D. unrunnable runtime and a real timeout still prove nothing ------
    const unrunnable = run("namla-s16-no-such-runtime", containerEnumerationArgs());
    record("an unrunnable runtime is NOT reported removed", containerAbsenceProven(name, unrunnable) === false);
    const timedOut = run(docker, ["events"], 1500);
    record("a timed-out real call is NOT reported removed", containerAbsenceProven(name, timedOut) === false);
  } finally {
    // Always clean up, whatever happened above.
    run(docker, ["rm", "-f", name]);
  }

  // ---- 5. nothing survived ------------------------------------------------
  // Same unfiltered enumeration and same exact-identity predicate — the
  // survivor check must not reintroduce the filter semantics either.
  const survivors = run(docker, containerEnumerationArgs());
  record("no proof container survived", containerAbsenceProven(name, survivors));

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
