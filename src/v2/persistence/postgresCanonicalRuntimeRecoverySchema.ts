import { CANONICAL_PIPELINE_SEQUENCE } from "../architecture/canonicalPipelineRegistry";
import { V2_NAMLA_LOOP_GATE_STATE_SCHEMA } from "../loop/namlaLoopGate";
import { V2_CANONICAL_FROZEN_PLAN_CONTRACT_SCHEMA } from "../protocol/canonicalFrozenPlanContract";
import { V2_CANONICAL_RUNTIME_CURSOR_SCHEMA } from "../runtime/canonicalRuntimeStepper";
import { V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA } from "./canonicalRuntimeRecoveryCheckpoint";

export const V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_TABLE =
  "namla_v2_canonical_runtime_recovery_checkpoints" as const;

// Expressions and keys below are internal schema constants, never caller input.
const MAX_SAFE = "9007199254740991";
function exactObject(expression: string, fields: readonly string[]): string {
  const keys = `ARRAY[${fields.map((field) => `'${field}'`).join(", ")}]::text[]`;
  return `(CASE WHEN jsonb_typeof(${expression}) = 'object' THEN
    (${expression} ?& ${keys} AND (${expression} - ${keys}) = '{}'::jsonb)
    ELSE FALSE END)`;
}
function counter(expression: string, minimum = 0): string {
  const value = `(${expression} #>> '{}')::numeric`;
  return `(CASE WHEN jsonb_typeof(${expression}) = 'number' THEN
    (${value} BETWEEN ${minimum} AND ${MAX_SAFE} AND trunc(${value}) = ${value})
    ELSE FALSE END)`;
}
const budgetFields = ["maxTicks", "remainingTicks", "maxFixAttempts", "remainingFixAttempts",
  "maxProviderCalls", "remainingProviderCalls"] as const;
const gates = CANONICAL_PIPELINE_SEQUENCE.filter((node) => node.kind === "GATE");
const gateGuards = gates.map((node, index) => {
  const state = `(checkpoint #> '{gateStates,${index}}')`;
  return `(
    ${exactObject(state, ["schemaVersion", "missionId", "stageId", "workPackageId",
      "maxLivelockThreshold", "livelockCounter"])}
    AND jsonb_typeof(${state} -> 'schemaVersion') = 'string'
    AND jsonb_typeof(${state} -> 'missionId') = 'string'
    AND jsonb_typeof(${state} -> 'stageId') = 'string'
    AND ${state} ->> 'schemaVersion' = '${V2_NAMLA_LOOP_GATE_STATE_SCHEMA}'
    AND ${state} ->> 'missionId' = mission_id
    AND ${state} ->> 'stageId' = '${node.id}'
    AND ${state} -> 'workPackageId' = 'null'::jsonb
    AND ${counter(`(${state} -> 'maxLivelockThreshold')`)}
    AND ${counter(`(${state} -> 'livelockCounter')`)}
  )`;
});
const binding = "(checkpoint -> 'frozenContract')";

/**
 * Dedicated v2 table; no alteration, fallback or automatic upgrade of v1 rows.
 * Migration 4 owns creation. The versioned layout must not change silently after
 * deployment. JSON checks require IS TRUE, not merely absence of FALSE.
 * The application validator still owns canonical cursor/phase membership,
 * history/transition rules and verification against an independently trusted
 * contract pin. DDL is NOT proof of gate passage, authorization or execution.
 */
export const V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_SCHEMA_SQL = `
CREATE TABLE ${V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_TABLE} (
  mission_id TEXT PRIMARY KEY CHECK (length(btrim(mission_id)) > 0),
  schema_version TEXT NOT NULL CHECK (schema_version = '${V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA}'),
  checkpoint_version BIGINT NOT NULL CHECK (checkpoint_version BETWEEN 1 AND ${MAX_SAFE}),
  cursor_step_version BIGINT NOT NULL CHECK (cursor_step_version BETWEEN 1 AND ${MAX_SAFE}),
  checkpoint JSONB NOT NULL,
  saved_at BIGINT NOT NULL CHECK (saved_at BETWEEN 1 AND ${MAX_SAFE}),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (checkpoint_version >= cursor_step_version),

  CONSTRAINT recovery_v2_json_shape CHECK ((
    ${exactObject("checkpoint", ["schemaVersion", "missionId", "checkpointVersion", "cursor", "savedAt",
      "loopBudget", "gateStates", "failureCount", "frozenContract"])}
    AND jsonb_typeof(checkpoint -> 'schemaVersion') = 'string'
    AND jsonb_typeof(checkpoint -> 'missionId') = 'string'
    AND ${counter("(checkpoint -> 'checkpointVersion')", 1)}
    AND ${counter("(checkpoint -> 'savedAt')", 1)}
    AND ${counter("(checkpoint -> 'failureCount')")}
    AND ${exactObject("(checkpoint -> 'cursor')", ["schemaVersion", "missionId", "nodeIndex", "nodeId",
      "nodeKind", "stepVersion", "contractPhase"])}
    AND jsonb_typeof(checkpoint #> '{cursor,schemaVersion}') = 'string'
    AND jsonb_typeof(checkpoint #> '{cursor,missionId}') = 'string'
    AND jsonb_typeof(checkpoint #> '{cursor,nodeId}') = 'string'
    AND jsonb_typeof(checkpoint #> '{cursor,nodeKind}') = 'string'
    AND jsonb_typeof(checkpoint #> '{cursor,contractPhase}') = 'string'
    AND ${counter("(checkpoint #> '{cursor,nodeIndex}')")}
    AND ${counter("(checkpoint #> '{cursor,stepVersion}')", 1)}
  ) IS TRUE),

  CONSTRAINT recovery_v2_row_binding CHECK ((
    checkpoint ->> 'schemaVersion' = schema_version
    AND checkpoint ->> 'missionId' = mission_id
    AND (checkpoint ->> 'checkpointVersion')::numeric = checkpoint_version
    AND (checkpoint ->> 'savedAt')::numeric = saved_at
    AND checkpoint #>> '{cursor,schemaVersion}' = '${V2_CANONICAL_RUNTIME_CURSOR_SCHEMA}'
    AND checkpoint #>> '{cursor,missionId}' = mission_id
    AND (checkpoint #>> '{cursor,stepVersion}')::numeric = cursor_step_version
    AND (checkpoint #>> '{cursor,nodeIndex}')::numeric + 1 = cursor_step_version
  ) IS TRUE),

  CONSTRAINT recovery_v2_budget CHECK ((
    ${exactObject("(checkpoint -> 'loopBudget')", budgetFields)}
    AND ${budgetFields.map((field) => counter(`(checkpoint #> '{loopBudget,${field}}')`)).join("\n    AND ")}
    AND (checkpoint #>> '{loopBudget,remainingTicks}')::numeric <= (checkpoint #>> '{loopBudget,maxTicks}')::numeric
    AND (checkpoint #>> '{loopBudget,remainingFixAttempts}')::numeric <= (checkpoint #>> '{loopBudget,maxFixAttempts}')::numeric
    AND (checkpoint #>> '{loopBudget,remainingProviderCalls}')::numeric <= (checkpoint #>> '{loopBudget,maxProviderCalls}')::numeric
  ) IS TRUE),

  CONSTRAINT recovery_v2_gates CHECK ((
    (CASE WHEN jsonb_typeof(checkpoint -> 'gateStates') = 'array'
      THEN jsonb_array_length(checkpoint -> 'gateStates') = ${gates.length} ELSE FALSE END)
    AND ${gateGuards.join("\n    AND ")}
  ) IS TRUE),

  CONSTRAINT recovery_v2_contract_phase CHECK ((
    (checkpoint #>> '{cursor,contractPhase}' = 'PRE_FREEZE' AND ${binding} = 'null'::jsonb)
    OR (checkpoint #>> '{cursor,contractPhase}' = 'CONTRACT_BOUND'
      AND ${exactObject(binding, ["schemaVersion", "missionId", "contractId", "contractVersion", "contractHash", "rawContractJson"])}
      AND jsonb_typeof(${binding} -> 'schemaVersion') = 'string'
      AND jsonb_typeof(${binding} -> 'missionId') = 'string'
      AND ${binding} ->> 'schemaVersion' = '${V2_CANONICAL_FROZEN_PLAN_CONTRACT_SCHEMA}'
      AND ${binding} ->> 'missionId' = mission_id
      AND jsonb_typeof(${binding} -> 'contractId') = 'string'
      AND jsonb_typeof(${binding} -> 'contractVersion') = 'string'
      AND jsonb_typeof(${binding} -> 'contractHash') = 'string'
      AND jsonb_typeof(${binding} -> 'rawContractJson') = 'string'
      AND ${binding} ->> 'contractHash' ~ '^[0-9a-f]{64}$'
      AND length(btrim(${binding} ->> 'contractId')) > 0
      AND length(btrim(${binding} ->> 'contractVersion')) > 0
      AND octet_length(${binding} ->> 'rawContractJson') BETWEEN 1 AND 4194304)
  ) IS TRUE)
);
`.trim();
