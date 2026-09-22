/**
 * C9A canonical trusted ToolGateway execution boundary.
 *
 * This is the first concrete implementation of C6's mandatory trusted executor
 * port. It is deliberately narrow:
 *
 * - only filesystem.read and filesystem.write are supported;
 * - the mission must be at canonical PRO under a pinned frozen PlanContract;
 * - the PostgreSQL task/operation claim is revalidated immediately before the
 *   effect;
 * - one virtual tick is durably reserved under the recovery checkpoint CAS
 *   before an effect;
 * - every filesystem effect is delegated to TrustedKernel;
 * - no shell, Git, Docker, provider, network or direct node:fs effect exists
 *   in this module.
 *
 * A success from Productization PolicyEngine remains entitlement preflight only.
 */

import { types } from "node:util";

import type { PermissionRequest } from "../domain/types";
import {
  PRODUCTIZATION_TOOL_OPERATION_TYPE,
  type ClaimedToolRequest,
  type GatewayToolBinding,
  type ToolJson,
  type TrustedToolExecutionBoundary,
  type TrustedToolOutcome,
} from "./tool-gateway";

import type { TrustedKernel } from "../v2/kernel/trustedKernel";
import type {
  PostgresExecutionAuthorityStore,
  PostgresOperationClaimValidationResult,
} from "../v2/persistence/postgresExecutionAuthorityStore";

import {
  restoreCanonicalRuntimeRecoveryCheckpoint,
  type CanonicalRuntimeRecoveryCheckpoint,
} from "../v2/persistence/canonicalRuntimeRecoveryCheckpoint";

import type {
  CanonicalRuntimeRecoveryStore,
} from "../v2/persistence/canonicalRuntimeRecoveryStore";

import {
  snapshotCanonicalRuntimeRecoveryPin,
} from "../v2/persistence/canonicalRuntimeRecoveryStore";

import {
  restoreCanonicalFrozenPlanContract,
  type CanonicalFrozenPlanContractIdentity,
} from "../v2/protocol/canonicalFrozenPlanContract";

import {
  debitCanonicalRuntimeLoopBudget,
} from "../v2/runtime/canonicalRuntimeLoopBudget";

import type {
  CapabilityScope,
  PlanContract,
} from "../v2/types/contracts";

export const CANONICAL_TRUSTED_TOOL_EXECUTOR_VERSION = 1 as const;
export const CANONICAL_FILESYSTEM_READ_TOOL = "filesystem.read" as const;
export const CANONICAL_FILESYSTEM_WRITE_TOOL = "filesystem.write" as const;

export const CANONICAL_TOOL_EFFECT_BUDGET_COST =
  Object.freeze({
    virtualTicks: 1,
    providerCalls: 0,
    fixAttempts: 0,
  });

const MAX_PATH_LENGTH = 4096;
const MAX_WRITE_CHARS = 512 * 1024;
const MAX_READ_CHARS = 512 * 1024;

type ClaimFenceStore =
  Pick<
    PostgresExecutionAuthorityStore,
    "validateOperationClaim"
  >;

type RecoveryStore =
  Pick<
    CanonicalRuntimeRecoveryStore,
    "load" | "compareAndSet"
  >;

export interface CanonicalTrustedToolExecutorOptions {
  readonly kernel: TrustedKernel;
  readonly authorityStore: ClaimFenceStore;
  readonly recoveryStore: RecoveryStore;
  readonly contractPin: CanonicalFrozenPlanContractIdentity;
  readonly clock?: () => number;
}

interface FilesystemReadInput {
  readonly path: string;
}

interface FilesystemWriteInput {
  readonly path: string;
  readonly content: string;
}

function refusal(): TrustedToolOutcome {
  return Object.freeze({
    status:
      "REFUSED_BEFORE_EFFECT" as const,
  });
}

function plainRecord(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> | null {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      types.isProxy(value)
    ) {
      return null;
    }

    const prototype: unknown =
      Object.getPrototypeOf(value);

    if (
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      return null;
    }

    if (
      Reflect.ownKeys(value).length !==
      fields.length
    ) {
      return null;
    }

    const captured:
      Record<string, unknown> =
        Object.create(null);

    for (const field of fields) {
      const descriptor =
        Object.getOwnPropertyDescriptor(
          value,
          field,
        );

      if (
        !descriptor ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        return null;
      }

      captured[field] =
        descriptor.value;
    }

    return captured;
  } catch {
    return null;
  }
}

function text(
  value: unknown,
  max: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!allowEmpty &&
      value.trim().length === 0) ||
    /[\u0000-\u001f\u007f]/u.test(
      allowEmpty ? "" : value,
    )
  ) {
    throw new Error(
      "CANONICAL_TRUSTED_TOOL_INPUT_INVALID",
    );
  }

  return value;
}

function pathText(value: unknown): string {
  const path =
    text(value, MAX_PATH_LENGTH);

  if (
    path !== path.trim() ||
    path.includes("\0")
  ) {
    throw new Error(
      "CANONICAL_TRUSTED_TOOL_PATH_INVALID",
    );
  }

  return path;
}

function readInput(
  value: unknown,
): FilesystemReadInput {
  const data =
    plainRecord(value, ["path"]);

  if (!data) {
    throw new Error(
      "CANONICAL_TRUSTED_TOOL_READ_INPUT_INVALID",
    );
  }

  return Object.freeze({
    path:
      pathText(data.path),
  });
}

function writeInput(
  value: unknown,
): FilesystemWriteInput {
  const data =
    plainRecord(
      value,
      ["path", "content"],
    );

  if (!data) {
    throw new Error(
      "CANONICAL_TRUSTED_TOOL_WRITE_INPUT_INVALID",
    );
  }

  return Object.freeze({
    path:
      pathText(data.path),

    content:
      text(
        data.content,
        MAX_WRITE_CHARS,
        true,
      ),
  });
}

const READ_BINDING:
  GatewayToolBinding =
    Object.freeze({
      name:
        CANONICAL_FILESYSTEM_READ_TOOL,

      revision:
        "canonical-filesystem-read-v1",

      validateInput(
        value: ToolJson,
      ): FilesystemReadInput {
        return readInput(value);
      },

      getPermissionRequests(
        value: ToolJson,
      ): readonly PermissionRequest[] {
        const input =
          readInput(value);

        return Object.freeze([
          Object.freeze({
            capability:
              `tool:${CANONICAL_FILESYSTEM_READ_TOOL}`,
            resource:
              input.path,
          }),
        ]);
      },
    });

const WRITE_BINDING:
  GatewayToolBinding =
    Object.freeze({
      name:
        CANONICAL_FILESYSTEM_WRITE_TOOL,

      revision:
        "canonical-filesystem-write-v1",

      validateInput(
        value: ToolJson,
      ): FilesystemWriteInput {
        return writeInput(value);
      },

      getPermissionRequests(
        value: ToolJson,
      ): readonly PermissionRequest[] {
        const input =
          writeInput(value);

        return Object.freeze([
          Object.freeze({
            capability:
              `tool:${CANONICAL_FILESYSTEM_WRITE_TOOL}`,
            resource:
              input.path,
          }),
        ]);
      },
    });

export const CANONICAL_TRUSTED_FILESYSTEM_BINDINGS:
  readonly GatewayToolBinding[] =
    Object.freeze([
      READ_BINDING,
      WRITE_BINDING,
    ]);

function captureMethod<
  T extends (...args: never[]) => unknown,
>(
  owner: object,
  key: string,
): T {
  if (
    typeof owner !== "object" ||
    owner === null ||
    types.isProxy(owner)
  ) {
    throw new Error(
      "CANONICAL_TRUSTED_TOOL_CONFIGURATION_INVALID",
    );
  }

  let at: object | null =
    owner;

  for (
    let depth = 0;
    at !== null && depth < 16;
    depth += 1,
      at = Object.getPrototypeOf(at)
  ) {
    if (types.isProxy(at)) {
      throw new Error(
        "CANONICAL_TRUSTED_TOOL_CONFIGURATION_INVALID",
      );
    }

    const descriptor =
      Object.getOwnPropertyDescriptor(
        at,
        key,
      );

    if (!descriptor) {
      continue;
    }

    if (
      !("value" in descriptor) ||
      typeof descriptor.value !==
        "function" ||
      types.isProxy(descriptor.value)
    ) {
      throw new Error(
        "CANONICAL_TRUSTED_TOOL_CONFIGURATION_INVALID",
      );
    }

    return descriptor.value.bind(
      owner,
    ) as T;
  }

  throw new Error(
    "CANONICAL_TRUSTED_TOOL_CONFIGURATION_INVALID",
  );
}

function validPositiveInteger(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function sameClaim(
  expected:
    ClaimedToolRequest["claim"],
  actual:
    ClaimedToolRequest["claim"],
): boolean {
  return (
    actual.status === "RUNNING" &&
    actual.operationKey ===
      expected.operationKey &&
    actual.missionId ===
      expected.missionId &&
    actual.taskId ===
      expected.taskId &&
    actual.authorityScope ===
      expected.authorityScope &&
    actual.operationType ===
      expected.operationType &&
    actual.inputFingerprint ===
      expected.inputFingerprint &&
    actual.claimOwnerWorkerId ===
      expected.claimOwnerWorkerId &&
    actual.claimTaskLeaseToken ===
      expected.claimTaskLeaseToken &&
    actual.claimTaskLeaseEpoch ===
      expected.claimTaskLeaseEpoch &&
    actual.claimToken ===
      expected.claimToken &&
    actual.claimEpoch ===
      expected.claimEpoch &&
    actual.claimExpiresAt ===
      expected.claimExpiresAt
  );
}

function exactPermission(
  request: ClaimedToolRequest,
  path: string,
): PermissionRequest | null {
  if (
    request.permissionRequests.length !== 1
  ) {
    return null;
  }

  const permission =
    request.permissionRequests[0];

  const data =
    plainRecord(
      permission,
      ["capability", "resource"],
    );

  if (!data) {
    return null;
  }

  if (
    data.capability !==
      `tool:${request.toolName}` ||
    data.resource !== path
  ) {
    return null;
  }

  return permission;
}

function scopeFor(
  request: ClaimedToolRequest,
  path: string,
): CapabilityScope | null {
  if (
    request.toolName ===
      CANONICAL_FILESYSTEM_READ_TOOL
  ) {
    return Object.freeze({
      capability:
        "filesystem.read",
      target:
        path,
      readOnly:
        true,
    });
  }

  if (
    request.toolName ===
      CANONICAL_FILESYSTEM_WRITE_TOOL
  ) {
    return Object.freeze({
      capability:
        "filesystem.write",
      target:
        path,
      readOnly:
        false,
    });
  }

  return null;
}

export class CanonicalTrustedToolExecutor
  implements TrustedToolExecutionBoundary {
  private readonly validateClaim:
    ClaimFenceStore["validateOperationClaim"];

  private readonly loadRecovery:
    RecoveryStore["load"];

  private readonly compareRecovery:
    RecoveryStore["compareAndSet"];

  private readonly evaluateAuthority:
    TrustedKernel["evaluateEffectiveAuthority"];

  private readonly readFile:
    TrustedKernel["safeReadWorkspaceFile"];

  private readonly writeFile:
    TrustedKernel["safeWriteWorkspaceFile"];

  private readonly pin:
    CanonicalFrozenPlanContractIdentity;

  private readonly clock:
    () => number;

  public constructor(
    options:
      CanonicalTrustedToolExecutorOptions,
  ) {
    const captured =
      snapshotCanonicalRuntimeRecoveryPin(
        options.contractPin,
      );

    if (
      !captured.ok ||
      captured.pin === null
    ) {
      throw new Error(
        "CANONICAL_TRUSTED_TOOL_CONTRACT_PIN_REQUIRED",
      );
    }

    this.pin =
      captured.pin;

    this.validateClaim =
      captureMethod<
        ClaimFenceStore["validateOperationClaim"]
      >(
        options.authorityStore as object,
        "validateOperationClaim",
      );

    this.loadRecovery =
      captureMethod<
        RecoveryStore["load"]
      >(
        options.recoveryStore as object,
        "load",
      );

    this.compareRecovery =
      captureMethod<
        RecoveryStore["compareAndSet"]
      >(
        options.recoveryStore as object,
        "compareAndSet",
      );

    this.evaluateAuthority =
      captureMethod<
        TrustedKernel["evaluateEffectiveAuthority"]
      >(
        options.kernel as object,
        "evaluateEffectiveAuthority",
      );

    this.readFile =
      captureMethod<
        TrustedKernel["safeReadWorkspaceFile"]
      >(
        options.kernel as object,
        "safeReadWorkspaceFile",
      );

    this.writeFile =
      captureMethod<
        TrustedKernel["safeWriteWorkspaceFile"]
      >(
        options.kernel as object,
        "safeWriteWorkspaceFile",
      );

    if (
      options.clock !== undefined &&
      (
        typeof options.clock !==
          "function" ||
        types.isProxy(options.clock)
      )
    ) {
      throw new Error(
        "CANONICAL_TRUSTED_TOOL_CLOCK_INVALID",
      );
    }

    this.clock =
      options.clock ?? Date.now;
  }

  public async executeClaimed(
    request:
      ClaimedToolRequest,
    signal:
      AbortSignal,
  ): Promise<TrustedToolOutcome> {
    if (signal.aborted) {
      return refusal();
    }

    if (
      request.context.runId !==
        this.pin.missionId ||
      request.claim.missionId !==
        this.pin.missionId ||
      request.claim.operationKey !==
        request.context.operationId ||
      request.claim.taskId !==
        request.context.taskId ||
      request.claim.authorityScope !==
        request.context.authority
          .authorityScope ||
      request.claim.operationType !==
        PRODUCTIZATION_TOOL_OPERATION_TYPE ||
      request.claim.inputFingerprint !==
        request.inputFingerprint ||
      request.claim.status !== "RUNNING" ||
      request.claim.claimEpoch !== 1
    ) {
      return refusal();
    }

    const parsed =
      this.parseEffect(request);

    if (!parsed) {
      return refusal();
    }

    const firstFence =
      await this.currentFence(
        request,
      );

    if (!firstFence) {
      return refusal();
    }

    const loaded =
      await this.loadRecovery(
        this.pin.missionId,
        this.pin,
      );

    if (loaded === null) {
      return refusal();
    }

    const restored =
      restoreCanonicalRuntimeRecoveryCheckpoint(
        loaded,
        this.pin,
      );

    if (
      !restored.ok ||
      restored.contract === null ||
      restored.checkpoint
        .cursor.contractPhase !==
        "CONTRACT_BOUND" ||
      restored.checkpoint
        .cursor.nodeId !== "PRO" ||
      restored.checkpoint
        .cursor.nodeKind !==
        "FACTORY" ||
      !request.context.authority
        .authorityScope
        .startsWith("PRO/")
    ) {
      return refusal();
    }

    const effective =
      this.evaluateAuthority(
        parsed.scope,
        restored.contract,
        restored.checkpoint
          .loopBudget
          .remainingTicks,
      );

    if (!effective.authorized) {
      return refusal();
    }

    const reserved =
      await this.reserveBudget(
        restored.checkpoint,
      );

    if (!reserved) {
      return refusal();
    }

    if (signal.aborted) {
      return refusal();
    }

    const secondFence =
      await this.currentFence(
        request,
      );

    if (!secondFence) {
      return refusal();
    }

    if (
      signal.aborted ||
      secondFence.now >=
        request.claim.claimExpiresAt
    ) {
      return refusal();
    }

    if (
      parsed.kind === "READ"
    ) {
      const read =
        this.readFile(
          parsed.path,
        );

      if (
        !read.success ||
        read.content === undefined
      ) {
        return refusal();
      }

      const truncated =
        read.content.length >
        MAX_READ_CHARS;

      return Object.freeze({
        status:
          "SUCCEEDED" as const,

        value:
          Object.freeze({
            content:
              read.content.slice(
                0,
                MAX_READ_CHARS,
              ),
            truncated,
          }),
      });
    }

    const write =
      this.writeFile(
        parsed.path,
        parsed.content,
        request.context.runId,
        request.context.taskId,
        request.context.operationId,
      );

    if (!write.success) {
      if (
        write.reasonCode ===
          "PATH_TRAVERSAL_REFUSED" ||
        write.reasonCode ===
          "SYMLINK_ESCAPE_REFUSED" ||
        write.reasonCode ===
          "SECRET_CONTENT_REFUSED"
      ) {
        return refusal();
      }

      // The write path can fail after an OS write during post-write
      // verification. Do not claim "before effect" in that case.
      throw new Error(
        "CANONICAL_TRUSTED_TOOL_WRITE_OUTCOME_UNKNOWN",
      );
    }

    const artifact =
      write.artifact;

    if (!artifact) {
      throw new Error(
        "CANONICAL_TRUSTED_TOOL_WRITE_RECEIPT_MISSING",
      );
    }

    return Object.freeze({
      status:
        "SUCCEEDED" as const,

      value:
        Object.freeze({
          artifactId:
            artifact.artifactId,
          path:
            artifact.path,
          sha256:
            artifact.sha256,
          sizeBytes:
            artifact.sizeBytes,
          missionId:
            artifact.missionId,
        }),
    });
  }

  private parseEffect(
    request:
      ClaimedToolRequest,
  ):
    | {
        readonly kind: "READ";
        readonly path: string;
        readonly scope: CapabilityScope;
      }
    | {
        readonly kind: "WRITE";
        readonly path: string;
        readonly content: string;
        readonly scope: CapabilityScope;
      }
    | null {
    try {
      if (
        request.toolName ===
          CANONICAL_FILESYSTEM_READ_TOOL
      ) {
        const input =
          readInput(
            request.input,
          );

        if (
          !exactPermission(
            request,
            input.path,
          )
        ) {
          return null;
        }

        const scope =
          scopeFor(
            request,
            input.path,
          );

        return scope
          ? Object.freeze({
              kind:
                "READ" as const,
              path:
                input.path,
              scope,
            })
          : null;
      }

      if (
        request.toolName ===
          CANONICAL_FILESYSTEM_WRITE_TOOL
      ) {
        const input =
          writeInput(
            request.input,
          );

        if (
          !exactPermission(
            request,
            input.path,
          )
        ) {
          return null;
        }

        const scope =
          scopeFor(
            request,
            input.path,
          );

        return scope
          ? Object.freeze({
              kind:
                "WRITE" as const,
              path:
                input.path,
              content:
                input.content,
              scope,
            })
          : null;
      }

      return null;
    } catch {
      return null;
    }
  }

  private async currentFence(
    request:
      ClaimedToolRequest,
  ): Promise<
    Extract<
      PostgresOperationClaimValidationResult,
      { readonly ok: true }
    > | null
  > {
    const result =
      await this.validateClaim({
        operationKey:
          request.context.operationId,

        authority:
          request.context.authority,

        claimToken:
          request.claim.claimToken,

        claimEpoch:
          request.claim.claimEpoch,
      });

    if (
      !result.ok ||
      !sameClaim(
        request.claim,
        result.record,
      )
    ) {
      return null;
    }

    return result;
  }

  private async reserveBudget(
    current:
      CanonicalRuntimeRecoveryCheckpoint,
  ): Promise<boolean> {
    const charged =
      debitCanonicalRuntimeLoopBudget(
        current.loopBudget,
        CANONICAL_TOOL_EFFECT_BUDGET_COST,
      );

    if (!charged.ok) {
      return false;
    }

    const now =
      this.clock();

    if (
      !validPositiveInteger(now)
    ) {
      throw new Error(
        "CANONICAL_TRUSTED_TOOL_CLOCK_INVALID",
      );
    }

    const next:
      CanonicalRuntimeRecoveryCheckpoint =
        Object.freeze({
          ...current,

          checkpointVersion:
            current.checkpointVersion + 1,

          savedAt:
            Math.max(
              current.savedAt,
              now,
            ),

          loopBudget:
            charged.budget,
        });

    const receipt =
      await this.compareRecovery(
        current.missionId,
        current.checkpointVersion,
        next,
        this.pin,
        this.pin,
      );

    return (
      receipt.status ===
        "UPDATED" &&
      receipt.checkpointVersion ===
        next.checkpointVersion
    );
  }
}
