/**
 * Production implementation of the IsolatedDockerBuildExecutor contract.
 *
 * This layer deliberately does NOT know how BuildKit works. Its authority is
 * limited to:
 *
 *   candidate workspace
 *     -> deterministic secure staging
 *     -> pinned/revalidated ProductionWslLauncher
 *
 * The Linux entrypoint behind ProductionWslLauncher owns the next boundary:
 * staging reconstruction, hardened systemd/rootless execution, BuildKit,
 * timeout enforcement, and mandatory cleanup proof.
 *
 * There is no host-Docker or alternative-runtime fallback here.
 */

import {
  type IsolatedDockerBuildExecutor,
  type IsolatedDockerBuildRequest,
  type IsolatedDockerBuildResult,
} from "./isolatedDockerBuild";

import {
  stageProductionWorkspace,
  type ProductionWorkspaceStagingResult,
} from "./productionWorkspaceStager";

import {
  ProductionWslLauncher,
  PRODUCTION_WSL_MAX_TIMEOUT_MS,
  PRODUCTION_WSL_MIN_TIMEOUT_MS,
  type ProductionWslLaunchResult,
} from "./productionWslLauncher";

export type ProductionWorkspaceStager = (
  workspaceAbsolutePath: string,
) => ProductionWorkspaceStagingResult;

export interface ProductionIsolatedDockerBuildLauncher {
  launchBuildPayload(
    payload: Buffer,
    timeoutMs: number,
  ): ProductionWslLaunchResult;
}

export interface ProductionIsolatedDockerBuildExecutorOptions {
  /** Test seam only. Production uses stageProductionWorkspace. */
  readonly stager?: ProductionWorkspaceStager;

  /** Test seam only. Production uses ProductionWslLauncher. */
  readonly launcher?: ProductionIsolatedDockerBuildLauncher;
}

function failure(
  reasonCode: string,
  stderr: string,
  exitCode: number | null = null,
  stdout = "",
): IsolatedDockerBuildResult {
  return {
    success: false,
    exitCode,
    stdout,
    stderr,
    reasonCode,
  };
}

/**
 * missionId/stageId remain host-side evidence identifiers. They are NOT sent
 * to Linux and never become a path, executable, systemd unit, shell token, or
 * BuildKit argument.
 *
 * Still bound and control-character-free so an invalid caller cannot turn
 * receipt/log metadata into an unbounded or multiline field.
 */
function validEvidenceIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 256 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

/**
 * The kernel models Docker verification as `docker build -t <tag> .`.
 *
 * The isolated backend does not need to publish a host-Docker image and never
 * passes this value to a shell, but accepting malformed Docker-tag syntax would
 * make the evidence claim dishonest. Refuse rather than normalize.
 */
function validDockerImageTag(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(value)
  );
}

function stagingReasonCode(
  reasonCode: Exclude<
    ProductionWorkspaceStagingResult["reasonCode"],
    "OK"
  >,
): string {
  return `ISOLATED_DOCKER_${reasonCode}`;
}

function launcherReasonCode(
  result: ProductionWslLaunchResult,
): string {
  return result.success
    ? "OK"
    : `ISOLATED_DOCKER_${result.reasonCode}`;
}

export class ProductionIsolatedDockerBuildExecutor
  implements IsolatedDockerBuildExecutor
{
  private readonly stager: ProductionWorkspaceStager;
  private readonly launcher: ProductionIsolatedDockerBuildLauncher;

  public constructor(
    options: ProductionIsolatedDockerBuildExecutorOptions = {},
  ) {
    this.stager = options.stager ?? stageProductionWorkspace;
    this.launcher =
      options.launcher ?? new ProductionWslLauncher();
  }

  public build(
    request: IsolatedDockerBuildRequest,
  ): IsolatedDockerBuildResult {
    if (
      typeof request !== "object" ||
      request === null ||
      typeof request.workspaceAbsolutePath !== "string" ||
      request.workspaceAbsolutePath.length === 0
    ) {
      return failure(
        "ISOLATED_DOCKER_REQUEST_REFUSED",
        "Isolated Docker build request refused",
      );
    }

    if (
      !validEvidenceIdentifier(request.missionId) ||
      !validEvidenceIdentifier(request.stageId)
    ) {
      return failure(
        "ISOLATED_DOCKER_REQUEST_REFUSED",
        "Isolated Docker build evidence identifiers refused",
      );
    }

    if (!validDockerImageTag(request.imageTag)) {
      return failure(
        "ISOLATED_DOCKER_REQUEST_REFUSED",
        "Isolated Docker image tag refused",
      );
    }

    /*
     * Refuse the timeout BEFORE scanning potentially large candidate content.
     * The exact same bounds are enforced again by ProductionWslLauncher.
     */
    if (
      !Number.isInteger(request.timeoutMs) ||
      request.timeoutMs < PRODUCTION_WSL_MIN_TIMEOUT_MS ||
      request.timeoutMs > PRODUCTION_WSL_MAX_TIMEOUT_MS
    ) {
      return failure(
        "ISOLATED_DOCKER_REQUEST_REFUSED",
        "Isolated Docker build timeout refused",
      );
    }

    let staged: ProductionWorkspaceStagingResult;

    try {
      staged = this.stager(request.workspaceAbsolutePath);
    } catch {
      return failure(
        "ISOLATED_DOCKER_STAGER_ERROR",
        "Production workspace stager failed unexpectedly",
      );
    }

    if (!staged.ok) {
      return failure(
        stagingReasonCode(staged.reasonCode),
        `Production workspace staging refused: ${staged.reasonCode}`,
      );
    }

    let launched: ProductionWslLaunchResult;

    try {
      launched = this.launcher.launchBuildPayload(
        staged.payload,
        request.timeoutMs,
      );
    } catch {
      return failure(
        "ISOLATED_DOCKER_WSL_LAUNCHER_ERROR",
        "Production WSL launcher failed unexpectedly",
      );
    }

    return {
      success: launched.success,
      exitCode: launched.exitCode,
      stdout: launched.stdout,
      stderr: launched.stderr,
      reasonCode: launcherReasonCode(launched),
    };
  }
}