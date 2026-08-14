/**
 * CodexCliAdapter: the planned (never executed) provider identity for the
 * Codex CLI. See cliCognitiveWorkerBase.ts and plannedCliInvocation.ts for
 * why this never spawns a process.
 */

import type { CognitiveWorkRequest, CognitiveWorkerProfile } from "./cognitiveWorkTypes";
import { CLI_SUPPORTED_ROLES, CliCognitiveWorkerBase, displayNameFor } from "./cliCognitiveWorkerBase";
import type { ProviderExecutableId } from "../cognitive/providerProcessDriver";

/**
 * The fixed one-shot argument list. `exec` runs a single non-interactive
 * request and exits; `--sandbox read-only` means Codex cannot modify files or
 * run arbitrary commands on Namla's behalf. No element is ever built from
 * mission or task text.
 */
const CODEX_ONESHOT_ARGS: readonly string[] = ["exec", "--sandbox", "read-only", "--output-last-message", "response.json"];

export class CodexCliAdapter extends CliCognitiveWorkerBase {
  get profile(): CognitiveWorkerProfile {
    return {
      providerName: "codex",
      displayName: displayNameFor("codex"),
      supportedRoles: CLI_SUPPORTED_ROLES,
      realExecutionEnabled: false,
    };
  }

  protected get executableName(): string {
    return "codex";
  }

  protected get realExecutableId(): ProviderExecutableId {
    return "codex";
  }

  protected realArgumentList(): readonly string[] {
    return CODEX_ONESHOT_ARGS;
  }

  protected buildArgumentTemplate(_request: CognitiveWorkRequest): readonly string[] {
    return CODEX_ONESHOT_ARGS;
  }
}
