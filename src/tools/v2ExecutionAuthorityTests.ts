import test from "node:test";
import assert from "node:assert/strict";

import {
  OperationExecutionRecord,
  TaskExecutionAuthority,
  completeOperationClaim,
  decideOperationClaim,
  failOperationClaim,
  validateTaskExecutionAuthority,
} from "../v2/kernel/executionAuthority";

const NOW = 1_800_000_000_000;

function authority(
  overrides: Partial<TaskExecutionAuthority> = {},
): TaskExecutionAuthority {
  return {
    missionId: "mission-001",
    taskId: "task-001",
    workerId: "worker-a",
    authorityScope: "PRO/COLONY_A/task-001",
    leaseToken: "task-lease-a",
    leaseEpoch: 7,
    expiresAt: NOW + 120_000,
    ...overrides,
  };
}

function claim(
  overrides: Partial<Parameters<typeof decideOperationClaim>[0]> = {},
) {
  return decideOperationClaim({
    operationKey: "op-001",
    operationType: "tool.filesystem.write",
    value: { path: "a.txt", text: "hello" },
    authority: authority(),
    existing: null,
    now: NOW,
    claimDurationMs: 60_000,
    tokenFactory: () => "claim-token-a",
    ...overrides,
  });
}

function runningRecord(): OperationExecutionRecord {
  const result = claim();
  assert.equal(result.ok, true);
  assert.equal(result.status, "CLAIMED");
  assert.ok(result.record);
  return result.record;
}

test("R1B accepts live task authority", () => {
  assert.deepEqual(
    validateTaskExecutionAuthority(authority(), NOW),
    { ok: true, reasonCode: "ok" },
  );
});

test("R1B rejects expired task authority", () => {
  assert.equal(
    validateTaskExecutionAuthority(
      authority({ expiresAt: NOW }),
      NOW,
    ).reasonCode,
    "lease-expired",
  );
});

test("R1B rejects invalid lease epochs", () => {
  assert.equal(
    validateTaskExecutionAuthority(
      authority({ leaseEpoch: 0 }),
      NOW,
    ).reasonCode,
    "lease-epoch-invalid",
  );
});

test("R1B rejects empty authority fields", () => {
  assert.equal(
    validateTaskExecutionAuthority(
      authority({ workerId: " " }),
      NOW,
    ).reasonCode,
    "worker-id-empty",
  );
});

test("R1B creates first operation claim with epoch 1", () => {
  const result = claim();

  assert.equal(result.ok, true);
  assert.equal(result.status, "CLAIMED");
  assert.equal(result.record?.claimEpoch, 1);
  assert.equal(result.record?.claimToken, "claim-token-a");
});

test("R1B derives fingerprint internally from R1A", () => {
  const a = claim();
  const b = claim({
    tokenFactory: () => "claim-token-b",
  });

  assert.equal(a.inputFingerprint, b.inputFingerprint);
  assert.match(a.inputFingerprint ?? "", /^[0-9a-f]{64}$/);
});

test("R1B claim expiry cannot exceed task authority expiry", () => {
  const result = claim({
    authority: authority({
      expiresAt: NOW + 5_000,
    }),
  });

  assert.equal(result.record?.claimExpiresAt, NOW + 5_000);
});

test("R1B refuses excessive claim duration", () => {
  const result = claim({
    claimDurationMs: 5 * 60_000 + 1,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "claim-duration-invalid");
});

test("R1B same live caller reuses existing claim", () => {
  const existing = runningRecord();

  const result = claim({
    existing,
    tokenFactory: () => "must-not-replace",
  });

  assert.equal(result.ok, true);
  assert.equal(
    result.status,
    "ALREADY_CLAIMED_BY_CALLER",
  );
  assert.equal(result.record?.claimToken, existing.claimToken);
  assert.equal(result.record?.claimEpoch, existing.claimEpoch);
});

test("R1B live claim blocks another worker", () => {
  const existing = runningRecord();

  const result = claim({
    authority: authority({
      workerId: "worker-b",
      leaseToken: "task-lease-b",
      leaseEpoch: 8,
    }),
    existing,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "running-other-claim");
});

test("R1B expired claim takeover increments claim epoch", () => {
  const existing = {
    ...runningRecord(),
    claimExpiresAt: NOW - 1,
  };

  const result = claim({
    authority: authority({
      workerId: "worker-b",
      leaseToken: "task-lease-b",
      leaseEpoch: 8,
    }),
    existing,
    tokenFactory: () => "claim-token-b",
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "CLAIMED");
  assert.equal(
    result.record?.claimEpoch,
    existing.claimEpoch + 1,
  );
});

test("R1B changed input under same operation key is refused", () => {
  const existing = runningRecord();

  const result = claim({
    existing,
    value: { path: "a.txt", text: "changed" },
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.reasonCode,
    "input-fingerprint-mismatch",
  );
});

test("R1B authority-scope binding mismatch is refused", () => {
  const existing = {
    ...runningRecord(),
    claimExpiresAt: NOW - 1,
  };

  const result = claim({
    authority: authority({
      authorityScope: "PRO/COLONY_B/task-001",
    }),
    existing,
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.reasonCode,
    "existing-operation-binding-mismatch",
  );
});

test("R1B completed operation returns replay", () => {
  const existing = {
    ...runningRecord(),
    status: "COMPLETED" as const,
    finishedAt: NOW - 1,
  };

  const result = claim({ existing });

  assert.equal(result.ok, true);
  assert.equal(result.status, "REPLAY_COMPLETED");
});

test("R1B failed operation is terminal", () => {
  const existing = {
    ...runningRecord(),
    status: "FAILED" as const,
    finishedAt: NOW - 1,
  };

  const result = claim({ existing });

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "terminal-failed");
});

test("R1B valid owner completes a live claim", () => {
  const existing = runningRecord();

  const result = completeOperationClaim(
    existing,
    authority(),
    existing.claimToken,
    existing.claimEpoch,
    NOW + 1,
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "COMPLETED");
});

test("R1B valid owner can fail a live claim", () => {
  const existing = runningRecord();

  const result = failOperationClaim(
    existing,
    authority(),
    existing.claimToken,
    existing.claimEpoch,
    NOW + 1,
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "FAILED");
});

test("R1B stale claim token cannot complete", () => {
  const existing = runningRecord();

  const result = completeOperationClaim(
    existing,
    authority(),
    "stale-token",
    existing.claimEpoch,
    NOW + 1,
  );

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "claim-token-mismatch");
});

test("R1B stale claim epoch cannot complete", () => {
  const existing = runningRecord();

  const result = completeOperationClaim(
    existing,
    authority(),
    existing.claimToken,
    existing.claimEpoch + 1,
    NOW + 1,
  );

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "claim-epoch-mismatch");
});

test("R1B stale task lease token cannot complete", () => {
  const existing = runningRecord();

  const result = completeOperationClaim(
    existing,
    authority({ leaseToken: "new-task-lease" }),
    existing.claimToken,
    existing.claimEpoch,
    NOW + 1,
  );

  assert.equal(result.ok, false);
  assert.equal(
    result.reasonCode,
    "task-lease-token-mismatch",
  );
});

test("R1B stale task lease epoch cannot complete", () => {
  const existing = runningRecord();

  const result = completeOperationClaim(
    existing,
    authority({ leaseEpoch: 8 }),
    existing.claimToken,
    existing.claimEpoch,
    NOW + 1,
  );

  assert.equal(result.ok, false);
  assert.equal(
    result.reasonCode,
    "task-lease-epoch-mismatch",
  );
});

test("R1B expired operation claim cannot complete", () => {
  const existing = {
    ...runningRecord(),
    claimExpiresAt: NOW + 1,
  };

  const result = completeOperationClaim(
    existing,
    authority(),
    existing.claimToken,
    existing.claimEpoch,
    NOW + 1,
  );

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "claim-expired");
});

test("R1B expired task authority cannot complete", () => {
  const existing = runningRecord();

  const result = completeOperationClaim(
    existing,
    authority({ expiresAt: NOW + 1 }),
    existing.claimToken,
    existing.claimEpoch,
    NOW + 1,
  );

  assert.equal(result.ok, false);
  assert.equal(
    result.reasonCode,
    "task-authority:lease-expired",
  );
});

test("R1B different worker cannot complete another worker claim", () => {
  const existing = runningRecord();

  const result = completeOperationClaim(
    existing,
    authority({
      workerId: "worker-b",
      leaseToken: "task-lease-a",
      leaseEpoch: 7,
    }),
    existing.claimToken,
    existing.claimEpoch,
    NOW + 1,
  );

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "claim-owner-mismatch");
});

test("R1B finalized record cannot be finalized twice", () => {
  const existing = runningRecord();

  const first = completeOperationClaim(
    existing,
    authority(),
    existing.claimToken,
    existing.claimEpoch,
    NOW + 1,
  );

  assert.equal(first.ok, true);

  const second = completeOperationClaim(
    first.ok ? first.record : existing,
    authority(),
    existing.claimToken,
    existing.claimEpoch,
    NOW + 2,
  );

  assert.equal(second.ok, false);
  assert.equal(second.reasonCode, "operation-not-running");
});