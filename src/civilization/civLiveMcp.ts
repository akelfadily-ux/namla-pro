/**
 * civLiveMcp — the bounded MCP tool execution drivers for a live civilization run
 * (Build Law §28). Automated runs inject `FakeMcpExecutionDriver` (isReal=false)
 * so `realMcpExecutions` stays 0; the human live run injects `RealMcpExecutionDriver`,
 * which routes FILE tools through the already-authorized workspace boundary
 * (`smokeWorkspace`) and VERIFICATION tools through the single `child_process`
 * importer (`runVerificationCommand`) — hard-coded executable + args, shell:false,
 * cwd = the civilization workspace, no npm install, no Git, bounded output,
 * timeout, safe failure mapping. No provider receives a generic run-tool
 * capability; every result is validated before returning to an ant.
 *
 * This module imports no fs, no child_process, and no network directly.
 */

import { civDraw } from "./settlementTypes";
import type { McpToolId } from "./settlementTypes";
import type { McpExecutionDriver, McpExecutionInput, McpExecutionResult } from "./mcpNervousSystem";
import { writeLiveObjectiveFile } from "../cognitive/smokeWorkspace";
import type { SmokeWorkspaceHandle } from "../cognitive/smokeWorkspace";
import { runVerificationCommand } from "../cognitive/nodeProviderProcessDriver";
import type { VerificationSandboxExecutor } from "../cognitive/verificationSandbox";
import type { VerificationCommandId } from "../cognitive/nodeProviderProcessDriver";

export interface FakeMcpFaults {
  /** Tool id that deterministically fails once (isolated). */
  readonly failToolId?: McpToolId;
  readonly seed: number;
}

/** Deterministic fake MCP executor — no fs/process/network. */
export class FakeMcpExecutionDriver implements McpExecutionDriver {
  readonly kind = "fake-mcp" as const;
  readonly isReal = false;
  private callCount = 0;
  constructor(private readonly faults: FakeMcpFaults) {}
  execute(input: McpExecutionInput): McpExecutionResult {
    this.callCount += 1;
    if (this.faults.failToolId && input.toolId === this.faults.failToolId) {
      return { ok: false, failureCategory: "mcp-tool-failure", resultValid: false };
    }
    // A small deterministic residual failure rate so tool health varies.
    const failed = civDraw(this.faults.seed, this.callCount, input.toolId.length ^ input.tick, 0x2c1b3c6d) < 0.08;
    return failed ? { ok: false, failureCategory: "mcp-tool-failure", resultValid: false } : { ok: true, failureCategory: null, resultValid: true };
  }
}

/** Tools whose real execution writes a file (routed through the workspace boundary). */
const FILE_TOOLS: readonly McpToolId[] = ["workspace-file-create", "documentation"];
/** Tools whose real execution spawns an allowlisted verification command. */
const VERIFICATION_TOOL_MAP: Partial<Record<McpToolId, VerificationCommandId>> = { typecheck: "typecheck", tests: "test", build: "build" };

export interface RealMcpConfig {
  readonly handle: SmokeWorkspaceHandle;
  readonly perFileByteCap: number;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  /** Bounded content per file tool, keyed by relative path (reviewed before this point). */
  readonly contentForTask: (input: McpExecutionInput) => { readonly relPath: string; readonly content: string } | null;
  /**
   * §35: supplied by the trusted CLI composition root that already acquired the
   * typed human confirmation and composed (or failed to compose) a verified
   * sandbox. Never invented here;  means verification is
   * unavailable, not that it may run on the host.
   */
  readonly humanAuthorized: boolean;
  readonly sandbox: VerificationSandboxExecutor | null;
}

/**
 * The REAL MCP executor — HUMAN-ONLY, never used by any automated demo/test. File
 * tools go through `writeLiveObjectiveFile` (the authorized fs surface); the three
 * verification tools go through `runVerificationCommand` (the one child_process
 * importer). Anything else is a read-only/analysis tool that returns a validated
 * bounded result without side effects. It imports fs/child_process from NEITHER —
 * it delegates to the already-authorized modules.
 */
export class RealMcpExecutionDriver implements McpExecutionDriver {
  readonly kind = "real-mcp" as const;
  readonly isReal = true;
  private fileWrites = 0;
  private verificationRuns = 0;

  constructor(private readonly config: RealMcpConfig) {}

  get realFileWrites(): number {
    return this.fileWrites;
  }
  get realVerificationRuns(): number {
    return this.verificationRuns;
  }

  execute(input: McpExecutionInput): McpExecutionResult {
    if (FILE_TOOLS.includes(input.toolId)) {
      const spec = this.config.contentForTask(input);
      if (!spec) return { ok: false, failureCategory: "no-reviewed-content", resultValid: false };
      const res = writeLiveObjectiveFile(this.config.handle, spec.relPath, spec.content, this.config.perFileByteCap);
      if (res.ok) this.fileWrites += 1;
      return res.ok ? { ok: true, failureCategory: null, resultValid: true } : { ok: false, failureCategory: res.reasonCode, resultValid: false };
    }
    const vcmd = VERIFICATION_TOOL_MAP[input.toolId];
    if (vcmd) {
      const res = runVerificationCommand({ commandId: vcmd, workingDirectoryAbsolute: this.config.handle.absolutePath, timeoutMs: this.config.timeoutMs, maxOutputBytes: this.config.maxOutputBytes, humanAuthorized: this.config.humanAuthorized, sandbox: this.config.sandbox });
      if (res.ran) this.verificationRuns += 1;
      return res.status === "passed" ? { ok: true, failureCategory: null, resultValid: true } : { ok: false, failureCategory: res.failureCategory, resultValid: false };
    }
    // Read-only / analysis / knowledge tools: validated bounded result, no side effect.
    return { ok: true, failureCategory: null, resultValid: true };
  }
}
