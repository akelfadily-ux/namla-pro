import test from "node:test";
import assert from "node:assert/strict";

import { assertRunTransition, assertTaskTransition, InvalidRunTransitionError, InvalidTaskTransitionError } from "../domain/lifecycle";
import { RunStatus, TaskStatus } from "../domain/types";
import {
  BudgetExceededError,
  ConfigurationError,
  GateRejectedError,
  ModelProviderError,
  PermissionDeniedError,
  StateConflictError,
  ToolExecutionError,
} from "../domain/errors";

test("Task lifecycle transition rules", async (t) => {
  await t.test("allows valid transitions", () => {
    expectNoThrow(() => assertTaskTransition(TaskStatus.Created, TaskStatus.Assigned));
    expectNoThrow(() => assertTaskTransition(TaskStatus.Assigned, TaskStatus.Running));
    expectNoThrow(() => assertTaskTransition(TaskStatus.Running, TaskStatus.Testing));
    expectNoThrow(() => assertTaskTransition(TaskStatus.Testing, TaskStatus.Review));
    expectNoThrow(() => assertTaskTransition(TaskStatus.Review, TaskStatus.Approved));
  });

  await t.test("rejects bypassing review", () => {
    assert.throws(
      () => assertTaskTransition(TaskStatus.Running, TaskStatus.Approved),
      InvalidTaskTransitionError,
    );
  });

  await t.test("rejects transitions from terminal state Approved", () => {
    assert.throws(
      () => assertTaskTransition(TaskStatus.Approved, TaskStatus.Running),
      InvalidTaskTransitionError,
    );
  });
});

test("Run lifecycle transition rules", async (t) => {
  await t.test("allows valid run transitions", () => {
    expectNoThrow(() => assertRunTransition(RunStatus.Created, RunStatus.Planning));
    expectNoThrow(() => assertRunTransition(RunStatus.Planning, RunStatus.Running));
    expectNoThrow(() => assertRunTransition(RunStatus.Running, RunStatus.Completed));
  });

  await t.test("rejects illegal run transitions", () => {
    assert.throws(
      () => assertRunTransition(RunStatus.Created, RunStatus.Completed),
      InvalidRunTransitionError,
    );
  });
});

test("Domain Error Taxonomy invariants", async (t) => {
  await t.test("verifies non-retryable errors", () => {
    const permErr = new PermissionDeniedError("denied");
    assert.equal(permErr.code, "PERMISSION_DENIED");
    assert.equal(permErr.retryable, false);

    const budgetErr = new BudgetExceededError("exceeded");
    assert.equal(budgetErr.code, "BUDGET_EXCEEDED");
    assert.equal(budgetErr.retryable, false);

    const configErr = new ConfigurationError("invalid config");
    assert.equal(configErr.code, "CONFIGURATION_ERROR");
    assert.equal(configErr.retryable, false);

    const gateErr = new GateRejectedError("gate failed");
    assert.equal(gateErr.code, "GATE_REJECTED");
    assert.equal(gateErr.retryable, false);
  });

  await t.test("verifies retryable errors", () => {
    const conflictErr = new StateConflictError("optimistic locking failure");
    assert.equal(conflictErr.code, "STATE_CONFLICT");
    assert.equal(conflictErr.retryable, true);
  });

  await t.test("verifies dynamic retryability errors", () => {
    const modelErrRetryable = new ModelProviderError("503 Service Unavailable", true);
    assert.equal(modelErrRetryable.retryable, true);

    const modelErrFatal = new ModelProviderError("401 Unauthorized", false);
    assert.equal(modelErrFatal.retryable, false);

    const toolErr = new ToolExecutionError("timeout", true);
    assert.equal(toolErr.retryable, true);
  });
});

function expectNoThrow(fn: () => void) {
  assert.doesNotThrow(fn);
}
