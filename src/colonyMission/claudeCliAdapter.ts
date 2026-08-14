/**
 * ClaudeCliAdapter: the planned (never executed) provider identity for the
 * Claude Code CLI. See cliCognitiveWorkerBase.ts and plannedCliInvocation.ts
 * for why this never spawns a process. The argument template below is what
 * a future authorized phase would pass — hard-coded shape, prompt content
 * delivered through a bounded prompt file, never a positional shell
 * argument built from mission or task text.
 */

import type { CognitiveWorkRequest, CognitiveWorkerProfile } from "./cognitiveWorkTypes";
import { CLI_SUPPORTED_ROLES, CliCognitiveWorkerBase, displayNameFor } from "./cliCognitiveWorkerBase";
import type { ProviderExecutableId } from "../cognitive/providerProcessDriver";

/**
 * The fixed one-shot, non-interactive, cognition-only argument list. `--print`
 * emits one response and exits (no interactive session, no continuation);
 * `--permission-mode plan` means Claude cannot edit files or run tools on
 * Namla's behalf. No element is ever built from mission or task text.
 */
const CLAUDE_ONESHOT_ARGS: readonly string[] = ["--print", "--output-format", "json", "--permission-mode", "plan"];

export class ClaudeCliAdapter extends CliCognitiveWorkerBase {
  get profile(): CognitiveWorkerProfile {
    return {
      providerName: "claude",
      displayName: displayNameFor("claude"),
      supportedRoles: CLI_SUPPORTED_ROLES,
      realExecutionEnabled: false,
    };
  }

  protected get executableName(): string {
    return "claude";
  }

  protected get realExecutableId(): ProviderExecutableId {
    return "claude";
  }

  protected realArgumentList(): readonly string[] {
    return CLAUDE_ONESHOT_ARGS;
  }

  protected buildArgumentTemplate(_request: CognitiveWorkRequest): readonly string[] {
    return CLAUDE_ONESHOT_ARGS;
  }
}
