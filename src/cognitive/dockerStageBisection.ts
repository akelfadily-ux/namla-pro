/**
 * dockerStageBisection — finds WHICH flag Docker rejected, without ever
 * printing what Docker said.
 *
 * Run 30636242795 returned exit 125 with no stdout: Docker refused the run
 * before the container command executed. Exit 125 says "the daemon rejected
 * this invocation" but not which of ~20 flags caused it, and the full argv is
 * applied in one shot, so there is nothing to narrow down from.
 *
 * This adds the flags back in eight cumulative stages under the SAME approved
 * image, stopping at the first stage that fails. The last successful stage plus
 * the first failing one bracket the offending flag exactly, and the result is
 * a stage number rather than a message — no raw stderr is needed to act on it.
 *
 * Every stage is harmless: the command is `node --version` until stage 8, which
 * runs the real probe. Fixed argv, `shell: false`, no mission input, no
 * provider, forced cleanup after every stage regardless of outcome.
 *
 * CI-ONLY. Nothing here runs during normal mission execution.
 */

import { spawnSync } from "child_process";
import { approvedImageReference, containerAbsenceProven, containerEnumerationArgs, emptyEnvFilePath, resolveTrustedWorkspaceIdentity, IMAGE_DEFAULT_IDENTITY, CONTAINER_WORKSPACE_MOUNT, CONTAINER_SOURCE_MOUNT, CONTAINER_PROBE_MOUNT } from "./containerSandboxBackend";
import { classifyContainerStartup, type ContainerStderrCategory } from "./containerStartupDiagnostics";
import type { CanonicalMountSource } from "./safeMountSource";

/** The eight stages, in the order flags are introduced. */
export type StageNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface StageDefinition {
  readonly stage: StageNumber;
  readonly label: string;
  /** Flags ADDED at this stage (cumulative with all earlier stages). */
  readonly flags: readonly string[];
}

/**
 * Stage inputs carry PROVEN mount sources only (§31). Stages 7 and 8 build real
 * bind mounts, so the bisection is held to the same mount-source authorization
 * as production — a diagnostic tool must not be the one path that mounts an
 * unvalidated host directory.
 */
export interface StageInputs {
  readonly workspaceHostPath: CanonicalMountSource;
  readonly probeHostDir: CanonicalMountSource;
  readonly sourceHostPath: CanonicalMountSource | null;
}

/**
 * Cumulative stage definitions. Each stage is the previous argv plus its own
 * flags, so the first failure names the exact group that Docker refuses.
 */
/**
 * Trusted identity for a stage run, derived exactly as production derives it.
 * Falls back to the image default only when ownership cannot be proven, so a
 * bisection on an unprovable host still exercises a NON-ROOT identity.
 */
export function stageUserIdentity(workspaceHostPath: string): string {
  const r = resolveTrustedWorkspaceIdentity(workspaceHostPath);
  const id = r.ok ? r.identity : IMAGE_DEFAULT_IDENTITY;
  return String(id.uid) + ":" + String(id.gid);
}

export function stageDefinitions(inputs: StageInputs): readonly StageDefinition[] {
  return [
    { stage: 1, label: "baseline-image-and-command", flags: [] },
    { stage: 2, label: "user-and-privileges", flags: ["--user", stageUserIdentity(inputs.workspaceHostPath), "--security-opt", "no-new-privileges", "--cap-drop", "ALL"] },
    // `--pid private` removed: not a supported Docker value. The private PID
    // namespace is the default when the flag is omitted.
    { stage: 3, label: "private-ipc-namespace", flags: ["--ipc", "private"] },
    { stage: 4, label: "readonly-root-and-tmpfs", flags: ["--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m"] },
    { stage: 5, label: "resource-limits", flags: ["--cpus", "1", "--memory", "512m", "--memory-swap", "512m", "--pids-limit", "64", "--ulimit", "nofile=256:256", "--ulimit", "fsize=67108864"] },
    { stage: 6, label: "hostname-env-network", flags: ["--hostname", "namla-sandbox", "--env-file", emptyEnvFilePath(), "--network", "none"] },
    { stage: 7, label: "workspace-mount-and-workdir", flags: ["--mount", `type=bind,source=${inputs.workspaceHostPath},target=${CONTAINER_WORKSPACE_MOUNT},readonly=false`, "--workdir", CONTAINER_WORKSPACE_MOUNT] },
    { stage: 8, label: "probe-mount-and-probe-command", flags: ["--mount", `type=bind,source=${inputs.probeHostDir},target=${CONTAINER_PROBE_MOUNT},readonly=true`] },
  ];
}

/** The command run inside the container at each stage. Fixed argv only. */
export function stageCommand(stage: StageNumber): readonly string[] {
  // Stages 1-7 use a harmless version print. Only stage 8 runs the real probe,
  // by which point every flag is already known to be accepted.
  return stage === 8 ? ["node", `${CONTAINER_PROBE_MOUNT}/containerIsolationProbe.js`] : ["node", "--version"];
}

/** Build the FULL argv for a stage: all flags up to and including it. */
export function buildStageArgs(stage: StageNumber, inputs: StageInputs, containerName: string): string[] {
  const defs = stageDefinitions(inputs);
  const args: string[] = ["run", "--rm", "--name", containerName];
  for (const d of defs) {
    if (d.stage > stage) break;
    for (const f of d.flags) args.push(f);
  }
  args.push(approvedImageReference());
  for (const c of stageCommand(stage)) args.push(c);
  return args;
}

/** Injectable so tests can bisect deterministically with no Docker present. */
export interface StageRunner {
  run(args: readonly string[]): { readonly status: number | null; readonly signal: string | null; readonly stdout: string; readonly stderr: string; readonly errorCode?: string };
  remove(containerName: string): boolean;
}

/** The real runner. Fixed executable, shell:false, bounded. */
export class DockerStageRunner implements StageRunner {
  constructor(private readonly dockerCommand: string) {}

  run(args: readonly string[]): { status: number | null; signal: string | null; stdout: string; stderr: string; errorCode?: string } {
    const out = spawnSync(this.dockerCommand, [...args], { shell: false, encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    return {
      status: typeof out.status === "number" ? out.status : null,
      signal: (out.signal as string | null) ?? null,
      stdout: typeof out.stdout === "string" ? out.stdout : "",
      stderr: typeof out.stderr === "string" ? out.stderr : "",
      errorCode: (out.error as NodeJS.ErrnoException | undefined)?.code,
    };
  }

  remove(containerName: string): boolean {
    spawnSync(this.dockerCommand, ["rm", "-f", containerName], { shell: false, encoding: "utf8", timeout: 30000, maxBuffer: 65536, windowsHide: true });
    const query = spawnSync(this.dockerCommand, [...containerEnumerationArgs()], { shell: false, encoding: "utf8", timeout: 30000, killSignal: "SIGKILL", maxBuffer: 262144, windowsHide: true });
    return containerAbsenceProven(containerName, query);
  }
}

/**
 * SAFE bisection result — EXACTLY seven fields, nothing more.
 *
 * A stage LABEL and a last-successful-stage number were tempting to include,
 * but the permitted set is deliberately closed: `failedStage` already brackets
 * the offending flag (stage N failed, N-1 succeeded), and every additional
 * field is one more thing that must be re-audited for leakage. The label lives
 * in `stageDefinitions` where it is looked up by number instead.
 */
export interface SafeStageResult {
  /** null when every stage succeeded. */
  readonly failedStage: StageNumber | null;
  readonly runtimeExitCode: number | null;
  readonly runtimeSignal: string | null;
  readonly stdoutPresent: boolean;
  readonly stderrCategory: ContainerStderrCategory | null;
  readonly safeFailureFingerprint: string | null;
  readonly cleanupComplete: boolean;
}

/**
 * Run the stages in order and stop at the first failure.
 *
 * Cleanup runs after EVERY stage, successful or not, so a stage that leaves a
 * container behind cannot contaminate the next one or the host.
 */
export function runStageBisection(runner: StageRunner, inputs: StageInputs, namePrefix = "namla-bisect"): SafeStageResult {
  const defs = stageDefinitions(inputs);
  let cleanupComplete = true;

  for (const def of defs) {
    const containerName = `${namePrefix}-${def.stage}`;
    const args = buildStageArgs(def.stage, inputs, containerName);

    const out = runner.run(args);
    // Cleanup ALWAYS, before any decision about the result.
    const removed = runner.remove(containerName);
    if (!removed) cleanupComplete = false;

    const succeeded = out.status === 0 && !out.errorCode;
    if (succeeded) continue;

    const diag = classifyContainerStartup({ errorCode: out.errorCode, status: out.status, signal: out.signal, stdout: out.stdout, stderr: out.stderr });
    return { failedStage: def.stage, runtimeExitCode: diag.runtimeExitCode, runtimeSignal: diag.runtimeSignal, stdoutPresent: diag.stdoutPresent, stderrCategory: diag.stderrCategory, safeFailureFingerprint: diag.safeFailureFingerprint, cleanupComplete };
  }

  return { failedStage: null, runtimeExitCode: 0, runtimeSignal: null, stdoutPresent: true, stderrCategory: null, safeFailureFingerprint: null, cleanupComplete };
}

/** Safe one-liner. Names a stage, never a message. */
export function describeStageResult(r: SafeStageResult, inputs?: StageInputs): string {
  if (r.failedStage === null) return `all stages accepted (cleanup=${r.cleanupComplete})`;
  // The label is looked up by NUMBER, so it never has to be carried in the
  // persisted result.
  const label = inputs ? (stageDefinitions(inputs).find((d) => d.stage === r.failedStage)?.label ?? "unknown") : "";
  const suffix = label ? ` (${label})` : "";
  return `failedStage=${r.failedStage}${suffix} lastOk=${r.failedStage - 1 || "none"} exit=${r.runtimeExitCode ?? "null"} category=${r.stderrCategory} fp=${r.safeFailureFingerprint} cleanup=${r.cleanupComplete}`;
}
