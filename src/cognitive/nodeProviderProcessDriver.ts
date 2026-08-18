/**
 * NodeProviderProcessDriver — the ONE real one-shot process driver, and the
 * ONLY file in Namla Pro that imports `child_process` (Build Law §19).
 *
 * It runs exactly one child process with `shell: false`, an executable chosen
 * only from a hard-coded map (never a user path, never mission text), a fixed
 * argument list, bounded stdin, a timeout that kills the child, and bounded
 * stdout/stderr. It never spawns a detached, background, or child-tree process,
 * never retries, and never opens an interactive session.
 *
 * Environment: it never enumerates or logs `process.env`. It passes only a
 * small NAME allowlist (PATH/HOME/etc.) needed for executable resolution and
 * the provider CLI's own already-authenticated local session, and drops any
 * variable whose name matches KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL/COOKIE/
 * PRIVATE. No credential value is read, passed deliberately, persisted, or
 * logged. Raw stderr is returned INTERNALLY for a safe failure category only;
 * callers never write it to a receipt.
 *
 * This module is NOT imported by any automated demo or test. Automated
 * verification uses `FakeProviderProcessDriver` exclusively.
 */

import { spawnSync } from "child_process";
import { truncateUtf8 } from "./safeWorkspacePath";
// The env allowlist lives in the ONE outbound request boundary (§26) so there is
// a single definition of which variable names may ever reach a child process.
import { buildSafeChildEnv } from "./safeProviderRequest";
import { resolveTrustedExecutable, revalidateResolvedExecutable, VERIFICATION_ARGUMENT_TEMPLATES, type TrustedExecutableId } from "./trustedExecutableRegistry";
import { NodeProcessTreeDriver, buildProcessTreeHandle, DEFAULT_TERMINATION_POLICY, type ProcessTreeDriver, type ProcessTreeCleanupReceipt, type TerminationReason } from "./processTree";
// §35: the verification path no longer constructs a sandbox of its own. It
// receives a trusted executor and routes the permit through it, so the
// hard-coded `new SandboxPolicy(new UnavailableSandboxBackend())` — which made
// real sandbox routing impossible — is gone along with the host spawn.
import { buildVerificationSandboxPolicy, type VerificationSandboxExecutor } from "./verificationSandbox";
import type { SandboxExecutionReceipt, VerificationSafeReason } from "./sandboxPolicy";
import type {
  ProviderExecutableId,
  ProviderProcessDriver,
  ProviderProcessResult,
  ProviderProcessSpec,
} from "./providerProcessDriver";

// The executable map lives in `trustedExecutableRegistry.ts`: a bare name here
// would be resolved by the inherited PATH, which is attacker-controlled.

/**
 * Truncate provider output to a real UTF-8 BYTE budget (never a character count)
 * without producing broken UTF-8. Delegates to the shared byte kernel.
 */
function truncate(buffer: string, maxBytes: number): { text: string; truncated: boolean } {
  const t = truncateUtf8(buffer, maxBytes);
  return { text: t.text, truncated: t.truncated };
}

export class NodeProviderProcessDriver implements ProviderProcessDriver {
  readonly isReal = true;
  private spawnSequence = 0;
  private lastCleanupReceipt: ProcessTreeCleanupReceipt | null = null;

  constructor(private readonly treeDriver: ProcessTreeDriver = new NodeProcessTreeDriver()) {}

  /** Safe cleanup metadata for the most recent spawn. Never a command line. */
  get cleanupReceipt(): ProcessTreeCleanupReceipt | null {
    return this.lastCleanupReceipt;
  }

  /** Terminate the whole tree rooted at `pid`. Exactly one cleanup per spawn. */
  private sweepTree(pid: number | undefined, executable: string, reason: TerminationReason, timeoutMs: number): ProcessTreeCleanupReceipt | null {
    this.spawnSequence += 1;
    // processGroupCreated: false - spawnSync cannot create a group (see above).
    const handle = buildProcessTreeHandle(pid, executable, false, this.spawnSequence);
    if (!handle) return null;
    return this.treeDriver.terminate(handle, DEFAULT_TERMINATION_POLICY, reason, timeoutMs);
  }

  run(spec: ProviderProcessSpec): ProviderProcessResult {
    // Resolve to a TRUSTED ABSOLUTE PATH. A bare name would be resolved by the
    // inherited PATH, so anything earlier on PATH — including a file dropped in
    // a generated workspace — would run instead of the real provider.
    const resolved = resolveTrustedExecutable(spec.executableId as TrustedExecutableId, { workspaceRoots: [spec.workingDirectoryAbsolute] });
    if (!resolved.ok) {
      return {
        ran: false,
        exitCode: null,
        terminationSignalCategory: "none",
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        failureCategory: "spawn-failed",
      };
    }

    // Bounded in real UTF-8 bytes: a 10-emoji prompt is 10 chars but 40 bytes.
    const stdin = truncateUtf8(spec.stdinData, spec.maxStdinBytes).text;

    // §38: an unauthorized resolution is discoverable, never runnable.
    if (!resolved.value.executionAuthorized) {
      return { ran: false, exitCode: null, terminationSignalCategory: "none", stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false, failureCategory: "spawn-failed" };
    }

    // §38 TOCTOU: the executable was proven above; re-prove its sealed identity
    // at the last instruction before the process is created, so a file swapped
    // in between validation and spawn is refused rather than run.
    const stillTrusted = revalidateResolvedExecutable(resolved.value);
    if (stillTrusted !== "ok") {
      return { ran: false, exitCode: null, terminationSignalCategory: "none", stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false, failureCategory: "spawn-failed" };
    }

    const outcome = spawnSync(resolved.value.command, [...resolved.value.prefixArgs, ...spec.argumentList], {
      shell: false, // never a shell
      input: stdin, // bounded stdin (empty for positional-prompt providers -> stdin closed immediately, no hang)
      cwd: spec.workingDirectoryAbsolute,
      timeout: spec.timeoutMs,
      killSignal: "SIGKILL",
      // NOTE: spawnSync does NOT support `detached`, so this path establishes no
      // trusted POSIX process-group ownership. It also does not return until the
      // child has fully closed, so once it does, POSIX ownership can no longer be
      // proven at all. S-11 therefore REFUSES POSIX destructive cleanup rather
      // than enumerating or signalling stale PIDs. Windows is unaffected and
      // still uses its separately proven S-10 process-tree path.
      maxBuffer: spec.maxStdoutBytes + spec.maxStderrBytes + 1024,
      windowsHide: true,
      env: buildSafeChildEnv(),
      encoding: "utf8",
    });

    // sweepTree IS INVOKED ON EVERY EXIT PATH - success, timeout, cancellation,
    // spawn error - but what it does now differs by platform.
    //
    // POSIX: S-11 deliberately refuses destructive signalling here, because
    // ownership cannot be proven once spawnSync has returned - the root is
    // already reaped and its number may have been reissued. A detached POSIX
    // descendant may therefore LEAK, and the receipt reports cleanup incomplete
    // rather than implying a sweep. Recycled-PID safety on POSIX comes from
    // refusing to signal at all, NOT from post-hoc identity verification.
    //
    // Windows: the existing S-10 path still performs platform-specific cleanup,
    // proving identity through a trusted tasklist before any signal.
    const timedOutEarly = Boolean(outcome.error && (outcome.error as NodeJS.ErrnoException).code === "ETIMEDOUT") || outcome.signal === "SIGKILL";
    this.lastCleanupReceipt = this.sweepTree(outcome.pid, resolved.value.command, timedOutEarly ? "provider-timeout" : outcome.error ? "driver-error" : "completed", spec.timeoutMs);

    // Executable not found.
    if (outcome.error && (outcome.error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        ran: false,
        exitCode: null,
        terminationSignalCategory: "none",
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        failureCategory: "executable-missing",
      };
    }

    // Timeout — spawnSync sets error and signal on kill.
    const timedOut = Boolean(outcome.error && (outcome.error as NodeJS.ErrnoException).code === "ETIMEDOUT") || outcome.signal === "SIGKILL";
    if (timedOut) {
      return {
        ran: true,
        exitCode: null,
        terminationSignalCategory: "timeout-kill",
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        failureCategory: "timed-out",
      };
    }

    // Any other spawn error.
    if (outcome.error) {
      return {
        ran: false,
        exitCode: null,
        terminationSignalCategory: "none",
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        failureCategory: "spawn-failed",
      };
    }

    const out = truncate(typeof outcome.stdout === "string" ? outcome.stdout : "", spec.maxStdoutBytes);
    const err = truncate(typeof outcome.stderr === "string" ? outcome.stderr : "", spec.maxStderrBytes);
    const exitCode = outcome.status;

    return {
      ran: true,
      exitCode,
      terminationSignalCategory: outcome.signal ? "other-signal" : "none",
      stdout: out.text,
      stderr: err.text,
      stdoutTruncated: out.truncated,
      stderrTruncated: err.truncated,
      failureCategory: exitCode === 0 ? (out.truncated ? "output-truncated" : "none") : "non-zero-exit",
    };
  }
}

// --- V4 human-authorized allowlisted verification (Build Law §26) ----------
// This stays inside the ONE child_process module. It spawns a fixed verification
// executable (resolved through the trusted registry) with a fixed argument list, shell:false, cwd
// exactly the objective workspace, a timeout, and bounded output. It never runs
// npm install, never runs Git, never builds an argument from provider/mission
// text, and never retries. It is invoked ONLY by the human live CLI.

export type VerificationCommandId = "typecheck" | "test" | "build" | "lint";

export interface VerificationProcessSpec {
  readonly commandId: VerificationCommandId;
  /**
   * Human authorization for high-risk execution.
   *
   * S-13: REQUIRED. It was optional, and an omitted property is
   * indistinguishable from a deliberate `false` — so a trusted caller that
   * simply forgot the wiring received a refusal it could not explain. Stating it
   * is now mandatory. The runtime still compares `=== true`, so nothing about
   * the fail-closed behaviour changes; only the ability to omit it silently.
   */
  readonly humanAuthorized: boolean;
  readonly workingDirectoryAbsolute: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  /**
   * The trusted sandbox executor this command runs through (§35).
   *
   * REQUIRED and explicitly nullable: every call site must state its position.
   * `null` means no verified sandbox could be composed, which makes the command
   * unavailable — never a reason to run it on the host. There is no default and
   * no implicit backend, because a default here is exactly how a host fallback
   * gets reintroduced.
   */
  readonly sandbox: VerificationSandboxExecutor | null;
}

export interface VerificationProcessResult {
  readonly ran: boolean;
  /**
   * Always `null` now. A `SandboxExecutionReceipt` reports an exit CATEGORY,
   * not a numeric status, and inventing a number the sandbox never reported
   * would be fabricated data. `failureCategory` carries the truth instead.
   */
  readonly exitCode: number | null;
  readonly status: "passed" | "failed";
  /**
   * S-13: `null` means PASSED, and is the only representation of success. It
   * previously carried the string `"none"`, which meant a caller had to know
   * that one member of the reason vocabulary secretly meant "no failure" — and
   * a failed result could still carry it. Success is now structurally
   * distinguishable from every reason, and `VerificationSafeReason` no longer
   * contains any value that means success.
   */
  readonly failureCategory: VerificationSafeReason | null;
  /**
   * Line count of captured output. The sandbox receipt deliberately exposes no
   * stdout, so this is 0 whenever `outputObservable` is false — it is NOT a
   * claim that the command produced no output.
   */
  readonly outputLineCount: number;
  /** Whether output was observable at all. False on the sandboxed path. */
  readonly outputObservable: boolean;
}

// --- Pre-flight provider availability (Build Law §28 hardening) -------------
// A safe LOCAL availability probe for the human CLI's pre-flight: it runs the
// provider executable's own `--version` as a bounded child process (shell:false,
// hard-coded executable, fixed arg, short timeout, windowsHide, safe env). It is
// NOT a paid provider request — no prompt, no cognition, no cost — and is NEVER
// invoked by any automated demo/test. It reports only whether the executable
// resolved and a short, bounded version token (never raw multi-line output).

export interface ProviderAvailability {
  readonly provider: ProviderExecutableId;
  readonly available: boolean;
  /** Bounded first-line version token, or "" when unknown. Never full output. */
  readonly version: string;
  readonly failureCategory: string;
}

/** Probe one provider's local availability via its `--version` (safe, unpaid, bounded). */
export function detectProviderAvailability(provider: ProviderExecutableId, timeoutMs = 8000, untrustedRoots: readonly string[] = []): ProviderAvailability {
  // §38: the trust context is an explicit parameter rather than an omitted one.
  // This call previously passed `{}`, so a provider binary sitting inside the
  // very workspace being processed was eligible for a `--version` execution.
  const resolved = resolveTrustedExecutable(provider as TrustedExecutableId, { workspaceRoots: untrustedRoots });
  if (!resolved.ok) {
    return { provider, available: false, version: "", failureCategory: resolved.reasonCode };
  }
  if (!resolved.value.executionAuthorized) {
    return { provider, available: false, version: "", failureCategory: resolved.value.authorizationReason };
  }
  // TOCTOU: re-prove the sealed identity at the last instruction before spawn.
  const stillTrusted = revalidateResolvedExecutable(resolved.value);
  if (stillTrusted !== "ok") {
    return { provider, available: false, version: "", failureCategory: stillTrusted };
  }
  const outcome = spawnSync(resolved.value.command, [...resolved.value.prefixArgs, "--version"], {
    shell: false,
    input: "",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 4096,
    windowsHide: true,
    env: buildSafeChildEnv(),
    encoding: "utf8",
  });
  if (outcome.error && (outcome.error as NodeJS.ErrnoException).code === "ENOENT") {
    return { provider, available: false, version: "", failureCategory: "executable-missing" };
  }
  const timedOut = Boolean(outcome.error && (outcome.error as NodeJS.ErrnoException).code === "ETIMEDOUT") || outcome.signal === "SIGKILL";
  if (timedOut) return { provider, available: false, version: "", failureCategory: "timed-out" };
  if (outcome.error) return { provider, available: false, version: "", failureCategory: "spawn-failed" };
  // A bounded, single-line, alphanumeric-ish version token only.
  const firstLine = (typeof outcome.stdout === "string" ? outcome.stdout : "").split(/\r?\n/)[0] ?? "";
  const version = firstLine.replace(/[^A-Za-z0-9 ._+-]/g, "").slice(0, 40);
  const available = outcome.status === 0;
  return { provider, available, version, failureCategory: available ? "none" : "non-zero-exit" };
}

/**
 * Run one allowlisted verification command THROUGH the sandbox permit (§35).
 *
 * There is no host execution path in this function. `npm test` and
 * `npm run build` execute whatever a generated `package.json` puts in
 * `scripts`, so a verification command is arbitrary code execution by
 * definition — that is precisely why it must happen inside a container and why
 * it is NOT reclassified as deterministic or safe to make this easier.
 *
 * The sequence is fixed: authorize, then execute THE EXACT permit that
 * authorization returned. The permit's authority is object identity in an
 * issued-permit WeakSet, so it is never cloned, spread, serialized, or rebuilt
 * between the two calls — a reconstructed permit is a forged permit.
 */
function verificationFailure(failureCategory: VerificationSafeReason): VerificationProcessResult {
  return { ran: false, exitCode: null, status: "failed", failureCategory, outputLineCount: 0, outputObservable: false };
}

/**
 * Read a NON-SUCCESS reason out of a receipt that reports a non-success outcome.
 *
 * The receipt's `safeReasonCode` is a full `SandboxReasonCode`, which includes
 * `"ok"` — and `authorize` genuinely pairs `ok: false` with `"ok"` for a
 * low-risk request. Passing that straight through would produce a failure whose
 * stated reason is that nothing was wrong, which is the same class of untruth
 * S-13 exists to remove.
 *
 * So `"ok"` is not forwarded. Nor is it replaced by a guess about the cause:
 * the fallback reports only the STRUCTURAL fact the receipt itself asserts —
 * it was blocked, or it never started. A receipt claiming neither while also
 * claiming no fault is internally contradictory, and `backend-error` says
 * exactly that about the backend, not about the code being verified.
 */
function safeFailureReason(receipt: SandboxExecutionReceipt): VerificationSafeReason {
  const code = receipt.safeReasonCode;
  if (code !== "ok") return code;
  if (receipt.blocked) return "blocked";
  if (!receipt.executionStarted) return "not-started";
  return "backend-error";
}

export function runVerificationCommand(spec: VerificationProcessSpec): VerificationProcessResult {
  const entry = VERIFICATION_ARGUMENT_TEMPLATES[spec.commandId];
  if (!entry) return verificationFailure("unknown-command");

  // No injected executor means no verified sandbox was composed. Fail closed:
  // there is deliberately no implicit backend and no host fallback.
  const sandbox = spec.sandbox;
  if (sandbox === null || sandbox === undefined) return verificationFailure("sandbox-runtime-unavailable");

  const authorization = sandbox.authorize({
    objectiveId: spec.commandId,
    taskId: spec.commandId,
    workspaceId: spec.workingDirectoryAbsolute,
    // The executable and argv come ONLY from the hard-coded template. No
    // provider or mission text participates in either.
    executableId: entry.id,
    fixedArguments: entry.args,
    // The REAL host workspace, and network denied (§31/§32).
    policy: buildVerificationSandboxPolicy(spec.workingDirectoryAbsolute),
    riskLevel: "high-risk",
    humanAuthorized: spec.humanAuthorized === true,
  });
  if (!authorization.ok) return verificationFailure(safeFailureReason(authorization.receipt));

  // THE routing this milestone exists for: the permit is consumed by sandbox
  // execution rather than discarded. `authorization.permit` is passed by
  // identity, with nothing constructed in between.
  const receipt = sandbox.execute(authorization.permit);

  if (receipt.blocked || !receipt.executionStarted) {
    return verificationFailure(safeFailureReason(receipt));
  }

  // Map the receipt truthfully. Output is NOT observable through a sandbox
  // receipt — it exposes categories, limits and a fingerprint, never stdout —
  // so no line count is invented and no raw output is surfaced to preserve the
  // old field's shape.
  //
  // Success is ALL THREE conditions, and it is the only branch that reports no
  // reason. The previous mapping computed the reason first and derived success
  // separately, so a receipt claiming `completed` + clean cleanup but
  // `executionCompleted: false` produced a FAILURE whose reason was "none" — a
  // failure for no stated reason. Deriving the reason from the failure instead
  // makes that unrepresentable.
  const passed = receipt.exitCategory === "completed" && receipt.executionCompleted && receipt.cleanupComplete;
  if (passed) {
    return { ran: true, exitCode: null, status: "passed", failureCategory: null, outputLineCount: 0, outputObservable: false };
  }

  return {
    ran: true,
    exitCode: null,
    status: "failed",
    // A non-completed exit IS the reason (timed-out, non-zero-exit, ...). A
    // completed exit that still failed means the fault is in what the receipt
    // reported about it — cleanup, or a contradictory completion claim — so the
    // receipt's own non-success reason is used.
    failureCategory: receipt.exitCategory !== "completed" ? receipt.exitCategory : safeFailureReason(receipt),
    outputLineCount: 0,
    outputObservable: false,
  };
}
