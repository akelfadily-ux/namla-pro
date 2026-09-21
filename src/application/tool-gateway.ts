/**
 * C6 adaptation: coordinate Productization calls through the existing V2
 * operation authority. No donor StateRepository or ToolAdapter.execute path.
 *
 * Constructor dependencies are TRUSTED composition-root ports, not plugins or
 * proof objects. The mandatory executor must enforce the real kernel, budget,
 * contract, sandbox and current fencing checks at its effect boundary. This
 * component does not implement that executor or authenticate injected code.
 */
import { types } from "node:util";
import { ToolExecutionError } from "../domain/errors";
import type { PermissionRequest } from "../domain/types";
import type { ToolExecutionContext } from "../domain/contracts";
import { PolicyEngine } from "./policy-engine";
import { fingerprintOperation } from "./operation-fingerprint";
import { fingerprintOperationIdentity } from "../v2/kernel/operationIdentity";
import {
  validateTaskExecutionAuthority,
  type TaskExecutionAuthority,
  type OperationExecutionRecord,
} from "../v2/kernel/executionAuthority";
import type { PostgresExecutionAuthorityStore } from "../v2/persistence/postgresExecutionAuthorityStore";

export const PRODUCTIZATION_TOOL_GATEWAY_VERSION = 1 as const;
export const PRODUCTIZATION_TOOL_OPERATION_TYPE = "productization.tool-dispatch.v1" as const;
const RESULT_SCHEMA = "namla-productization-tool-result-v1";
function outputHash(call: BoundCall, value: ToolJson): string {
  return fingerprintOperationIdentity({missionId:call.context.runId,authorityScope:call.context.authority.authorityScope,
    operationType:"productization.tool-result.v1",value:[call.fingerprint,value]});
}
export type ToolJson = null | boolean | number | string |
  readonly ToolJson[] | { readonly [key: string]: ToolJson };
export type GatewayContext = Omit<ToolExecutionContext, "authority"> & {
  readonly authority: TaskExecutionAuthority;
};
/** Trusted pure input/permission mapping only. No executable adapter method. */
export interface GatewayToolBinding {
  readonly name: string;
  readonly revision: string;
  validateInput(value: ToolJson): unknown;
  getPermissionRequests(value: ToolJson, context: GatewayContext): readonly PermissionRequest[];
}
export interface ClaimedToolRequest {
  readonly toolName: string;
  readonly bindingRevision: string;
  readonly input: ToolJson;
  readonly context: GatewayContext;
  readonly permissionRequests: readonly PermissionRequest[];
  readonly inputFingerprint: string;
  readonly claim: OperationExecutionRecord;
}
export type TrustedToolOutcome =
  | { readonly status: "SUCCEEDED"; readonly value: unknown }
  | { readonly status: "REFUSED_BEFORE_EFFECT" };
/**
 * Trusted bootstrap must bind this port to canonical effect enforcement.
 * A cooperative AbortSignal is not process termination. A throw/timeout is an
 * UNKNOWN outcome, not proof of no effect and not permission to retry.
 */
export interface TrustedToolExecutionBoundary {
  executeClaimed(request: ClaimedToolRequest, signal: AbortSignal): Promise<TrustedToolOutcome>;
}
export type GatewayAuthorityStore = Pick<PostgresExecutionAuthorityStore,
  "claimOperation" | "completeOperation" | "failOperation">;
export interface ToolGatewayOptions {
  readonly bindings: readonly GatewayToolBinding[];
  readonly policy: PolicyEngine;
  readonly authorityStore: GatewayAuthorityStore;
  readonly executor: TrustedToolExecutionBoundary;
  readonly clock?: () => number;
}
export type GatewayRefusalReason = "INVALID_INPUT" | "INVALID_CONFIGURATION" |
  "UNKNOWN_TOOL" | "AUTHORITY_REQUIRED" | "PERMISSION_REFUSED" | "IN_FLIGHT" |
  "CLAIM_REFUSED" | "RECEIPT_INVALID" | "RECOVERY_REQUIRED" | "EXECUTOR_REFUSED" |
  "OUTCOME_UNKNOWN" | "STORAGE_FAILURE" | "FINALIZE_REFUSED" | "SESSION_FAILED_CLOSED";
export class ProductizationToolRefusal extends ToolExecutionError {
  constructor(public readonly reasonCode: GatewayRefusalReason) {
    // Retryability is never inferred from a timeout or uncertain persistence.
    super(`Productization tool refused: ${reasonCode}`, false);
  }
}
function refuse(reason: GatewayRefusalReason): never { throw new ProductizationToolRefusal(reason); }
const has = (v: object, k: string) => Object.prototype.hasOwnProperty.call(v, k);
function rec(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== "object" || value === null || types.isProxy(value)) refuse("INVALID_INPUT");
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) refuse("INVALID_INPUT");
  const keys = Reflect.ownKeys(value);
  if (keys.length > required.length + optional.length) refuse("INVALID_INPUT");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string" || (!required.includes(key) && !optional.includes(key))) refuse("INVALID_INPUT");
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !("value" in d) || !d.enumerable) refuse("INVALID_INPUT");
    result[key] = d.value;
  }
  if (required.some(k => !has(result, k))) refuse("INVALID_INPUT");
  return result;
}
function text(value: unknown, max = 512): string {
  if (typeof value !== "string" || !value.trim() || value.length > max ||
      /[\u0000-\u001f\u007f]/u.test(value)) refuse("INVALID_INPUT");
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) refuse("INVALID_INPUT");
  return value;
}
function dense(value: unknown, max: number): unknown[] {
  if (typeof value !== "object" || value === null || types.isProxy(value) ||
      !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) refuse("INVALID_INPUT");
  const n: unknown = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0 || n > max ||
      Reflect.ownKeys(value).length !== n + 1) refuse("INVALID_INPUT");
  const out: unknown[] = [];
  for (let i = 0; i < n; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !("value" in d) || !d.enumerable) refuse("INVALID_INPUT");
    out.push(d.value);
  }
  return out;
}
/** JSONB-compatible detached data, not a new canonical identity codec. */
function json(value: unknown): ToolJson {
  const active = new WeakSet<object>(); let nodes = 0, units = 0;
  const charge = (s: string) => {
    units += s.length;
    if (units > 1_048_576 || s.includes("\0") || Buffer.from(s, "utf8").toString("utf8") !== s) refuse("INVALID_INPUT");
  };
  const copy = (v: unknown, depth: number): ToolJson => {
    if (++nodes > 8192 || depth > 40) refuse("INVALID_INPUT");
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "string") { charge(v); return v; }
    if (typeof v === "number") {
      if (!Number.isFinite(v) || Object.is(v, -0)) refuse("INVALID_INPUT");
      return v;
    }
    if (typeof v !== "object" || types.isProxy(v) || active.has(v)) refuse("INVALID_INPUT");
    active.add(v);
    try {
      if (Array.isArray(v)) return Object.freeze(dense(v, 8192 - nodes).map(x => copy(x, depth + 1)));
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) refuse("INVALID_INPUT");
      const keys = Reflect.ownKeys(v);
      if (keys.length > 8192 - nodes) refuse("INVALID_INPUT");
      const out: Record<string, ToolJson> = Object.create(null);
      for (const k of keys) {
        if (typeof k !== "string") refuse("INVALID_INPUT");
        charge(k);
        const d = Object.getOwnPropertyDescriptor(v, k);
        if (!d || !("value" in d) || !d.enumerable) refuse("INVALID_INPUT");
        out[k] = copy(d.value, depth + 1);
      }
      return Object.freeze(out);
    } finally { active.delete(v); }
  };
  const out = copy(value, 0);
  if (Buffer.byteLength(JSON.stringify(out), "utf8") > 1_048_576) refuse("INVALID_INPUT");
  return out;
}
function authority(value: unknown): TaskExecutionAuthority {
  const a = rec(value, ["missionId", "taskId", "workerId", "authorityScope", "leaseToken", "leaseEpoch", "expiresAt"]);
  return Object.freeze({missionId:text(a.missionId), taskId:text(a.taskId), workerId:text(a.workerId),
    authorityScope:text(a.authorityScope), leaseToken:text(a.leaseToken), leaseEpoch:integer(a.leaseEpoch), expiresAt:integer(a.expiresAt)});
}
function context(value: unknown): GatewayContext {
  const c = rec(value, ["runId", "taskId", "antId", "traceId", "operationId", "permissions", "authority"]);
  const a = authority(c.authority);
  const result = Object.freeze({runId:text(c.runId),taskId:text(c.taskId),antId:text(c.antId),traceId:text(c.traceId),
    operationId:text(c.operationId), permissions:Object.freeze(dense(c.permissions,256).map(v=>text(v,4096))), authority:a});
  if (result.runId !== a.missionId || result.taskId !== a.taskId) refuse("AUTHORITY_REQUIRED");
  return result;
}
function captureMethod<T extends (...args: never[]) => unknown>(owner: object, key: string): T {
  if (!owner || typeof owner !== "object" || types.isProxy(owner)) refuse("INVALID_CONFIGURATION");
  let at: object | null = owner;
  for (let depth = 0; at && depth < 16; depth++, at = Object.getPrototypeOf(at)) {
    if (types.isProxy(at)) refuse("INVALID_CONFIGURATION");
    const d = Object.getOwnPropertyDescriptor(at, key);
    if (d) {
      if (!("value" in d) || typeof d.value !== "function" || types.isProxy(d.value)) refuse("INVALID_CONFIGURATION");
      return d.value.bind(owner) as T;
    }
  }
  return refuse("INVALID_CONFIGURATION");
}
interface BoundCall { readonly binding: GatewayToolBinding; readonly input: ToolJson; readonly context: GatewayContext;
  readonly permissions: readonly PermissionRequest[]; readonly productHash: string; readonly fingerprint: string; readonly identityValue: ToolJson; }
const RECORD_FIELDS = ["operationKey","missionId","taskId","authorityScope","operationType","inputFingerprint","status",
  "claimOwnerWorkerId","claimTaskLeaseToken","claimTaskLeaseEpoch","claimToken","claimEpoch","claimExpiresAt","createdAt","updatedAt"];
function receiptRecord(value: unknown, call: BoundCall, completed: boolean): OperationExecutionRecord {
  const r = rec(value, RECORD_FIELDS, ["finishedAt"]);
  for (const k of ["operationKey","missionId","taskId","authorityScope","operationType","inputFingerprint",
    "claimOwnerWorkerId","claimTaskLeaseToken","claimToken"]) text(r[k]);
  for (const k of ["claimTaskLeaseEpoch","claimEpoch","claimExpiresAt","createdAt","updatedAt"]) integer(r[k]);
  const c = call.context;
  if (r.operationKey !== c.operationId || r.missionId !== c.runId || r.taskId !== c.taskId ||
      r.authorityScope !== c.authority.authorityScope || r.operationType !== PRODUCTIZATION_TOOL_OPERATION_TYPE ||
      r.inputFingerprint !== call.fingerprint || !/^[0-9a-f]{64}$/.test(String(r.inputFingerprint)) ||
      Number(r.updatedAt) < Number(r.createdAt) || Number(r.claimExpiresAt) <= Number(r.createdAt)) refuse("RECEIPT_INVALID");
  if (completed) {
    if (r.status !== "COMPLETED" || integer(r.finishedAt) !== r.updatedAt) refuse("RECEIPT_INVALID");
  } else if (r.status !== "RUNNING" || r.finishedAt !== undefined || r.claimOwnerWorkerId !== c.authority.workerId ||
      r.claimTaskLeaseToken !== c.authority.leaseToken || r.claimTaskLeaseEpoch !== c.authority.leaseEpoch) refuse("RECEIPT_INVALID");
  return Object.freeze({...r}) as unknown as OperationExecutionRecord;
}

export class ToolGateway {
  private readonly bindings = new Map<string, GatewayToolBinding>();
  private readonly active = new Set<string>();
  private failedClosed = false;
  private readonly claim: GatewayAuthorityStore["claimOperation"];
  private readonly complete: GatewayAuthorityStore["completeOperation"];
  private readonly fail: GatewayAuthorityStore["failOperation"];
  private readonly executeBoundary: TrustedToolExecutionBoundary["executeClaimed"];
  private readonly authorize: PolicyEngine["authorize"];
  private readonly clock: () => number;

  constructor(options: ToolGatewayOptions) {
    try {
      const o = rec(options, ["bindings","policy","authorityStore","executor"], ["clock"]);
      this.claim = captureMethod(o.authorityStore as object, "claimOperation");
      this.complete = captureMethod(o.authorityStore as object, "completeOperation");
      this.fail = captureMethod(o.authorityStore as object, "failOperation");
      this.executeBoundary = captureMethod(o.executor as object, "executeClaimed");
      this.authorize = captureMethod(o.policy as object, "authorize");
      if (o.clock !== undefined && (typeof o.clock !== "function" || types.isProxy(o.clock))) refuse("INVALID_CONFIGURATION");
      this.clock = (o.clock as (() => number) | undefined) ?? Date.now;
      for (const item of dense(o.bindings, 256)) {
        // Binding data/methods must be own fields; donor execute is not accepted.
        const b = rec(item, ["name","revision","validateInput","getPermissionRequests"]);
        const name = text(b.name, 240), revision = text(b.revision, 128);
        if (!/^[a-z][a-z0-9_-]*(?:[.:][a-z][a-z0-9_-]*)*$/.test(name) || this.bindings.has(name)) refuse("INVALID_CONFIGURATION");
        this.bindings.set(name, Object.freeze({name, revision,
          validateInput:captureMethod<GatewayToolBinding["validateInput"]>(item as object, "validateInput"),
          getPermissionRequests:captureMethod<GatewayToolBinding["getPermissionRequests"]>(item as object, "getPermissionRequests")}));
      }
      if (!this.bindings.size) refuse("INVALID_CONFIGURATION");
    } catch { refuse("INVALID_CONFIGURATION"); }
  }
  public isFailedClosed(): boolean { return this.failedClosed; }
  private lock(reason: GatewayRefusalReason): never { this.failedClosed = true; return refuse(reason); }
  private fresh(): number { if (this.failedClosed) refuse("SESSION_FAILED_CLOSED"); return integer(this.clock()); }
  private checkPolicy(call: BoundCall): void {
    try { for (const request of call.permissions) this.authorize({permissions:call.context.permissions}, request); }
    catch { refuse("PERMISSION_REFUSED"); }
  }
  /** No implicit resume or retry, and no task-lease acquisition by this gateway. */
  public async execute(toolName: string, rawInput: unknown, rawContext: GatewayContext, timeoutMs = 60_000): Promise<ToolJson> {
    this.fresh();
    let call: BoundCall;
    try {
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) refuse("INVALID_INPUT");
      const binding = this.bindings.get(text(toolName,240));
      if (!binding) refuse("UNKNOWN_TOOL");
      const ctx = context(rawContext);
      if (!validateTaskExecutionAuthority(ctx.authority, this.fresh()).ok) refuse("AUTHORITY_REQUIRED");
      const input = json(binding.validateInput(json(rawInput)));
      const reqs = dense(binding.getPermissionRequests(input,ctx),64).map(r=>json(r) as unknown as PermissionRequest);
      if (!reqs.length || !reqs.some(r=>r.capability === "tool:"+binding.name)) refuse("PERMISSION_REFUSED");
      const permissions = Object.freeze(reqs);
      const productHash = fingerprintOperation({runId:ctx.runId,taskId:ctx.taskId,toolName:binding.name,value:input});
      const identityValue = json({schemaVersion:1,toolName:binding.name,bindingRevision:binding.revision,
        taskId:ctx.taskId,productHash,input,permissionRequests:permissions});
      const fingerprint = fingerprintOperationIdentity({missionId:ctx.runId,authorityScope:ctx.authority.authorityScope,
        operationType:PRODUCTIZATION_TOOL_OPERATION_TYPE,value:identityValue});
      call = {binding,input,context:ctx,permissions,productHash,fingerprint,identityValue};
      this.checkPolicy(call);
    } catch (error) {
      if (error instanceof ProductizationToolRefusal) throw error;
      return refuse("INVALID_INPUT");
    }
    const key = JSON.stringify([call.context.runId,call.context.operationId]);
    if (this.active.has(key)) refuse("IN_FLIGHT");
    this.active.add(key);
    try { return await this.run(call, timeoutMs); }
    finally { this.active.delete(key); }
  }
  private async run(call: BoundCall, timeoutMs: number): Promise<ToolJson> {
    const ctx = call.context;
    let reply: unknown;
    try { reply = await this.claim({operationKey:ctx.operationId,operationType:PRODUCTIZATION_TOOL_OPERATION_TYPE,
      value:call.identityValue,authority:ctx.authority,claimDurationMs:timeoutMs}); }
    catch { return this.lock("STORAGE_FAILURE"); }
    this.fresh();
    let r: Record<string, unknown>, claim: OperationExecutionRecord;
    try {
      r = rec(reply,["ok","status","reasonCode"],["inputFingerprint","record","completedValue"]);
      if (r.ok === false && r.status === "REFUSED" && typeof r.reasonCode === "string") refuse("CLAIM_REFUSED");
      if (r.ok !== true || r.reasonCode !== "ok" || r.inputFingerprint !== call.fingerprint ||
          !["CLAIMED","ALREADY_CLAIMED_BY_CALLER","REPLAY_COMPLETED"].includes(String(r.status))) refuse("RECEIPT_INVALID");
      claim = receiptRecord(r.record,call,r.status === "REPLAY_COMPLETED");
    } catch (error) {
      if (error instanceof ProductizationToolRefusal && error.reasonCode === "CLAIM_REFUSED") throw error;
      return this.lock("RECEIPT_INVALID");
    }
    if (r.status === "REPLAY_COMPLETED") {
      try {
        this.checkPolicy(call);
        if (!has(r,"completedValue")) refuse("RECEIPT_INVALID");
        const stored = rec(json(r.completedValue),["schemaVersion","toolName","bindingRevision","productHash","fingerprint","outputFingerprint","value"]);
        if (stored.schemaVersion !== RESULT_SCHEMA || stored.toolName !== call.binding.name ||
            stored.bindingRevision !== call.binding.revision || stored.productHash !== call.productHash ||
            stored.fingerprint !== call.fingerprint || stored.outputFingerprint !== outputHash(call,json(stored.value))) refuse("RECEIPT_INVALID");
        return json(stored.value);
      } catch (error) {
        if (error instanceof ProductizationToolRefusal && error.reasonCode === "PERMISSION_REFUSED") throw error;
        return this.lock("RECEIPT_INVALID");
      }
    }
    if (r.status === "ALREADY_CLAIMED_BY_CALLER") refuse("IN_FLIGHT");
    // Expired RUNNING may have had effects. The existing store can re-claim it;
    // a higher epoch is NEVER permission for this gateway to execute it again.
    if (claim.claimEpoch !== 1) return this.lock("RECOVERY_REQUIRED");
    const remaining = Math.min(timeoutMs,claim.claimExpiresAt-this.fresh(),ctx.authority.expiresAt-this.fresh());
    if (remaining < 1) return this.lock("RECOVERY_REQUIRED");
    try { this.checkPolicy(call); } catch { return this.lock("PERMISSION_REFUSED"); }
    const request: ClaimedToolRequest = Object.freeze({toolName:call.binding.name,bindingRevision:call.binding.revision,
      input:call.input,context:ctx,permissionRequests:call.permissions,inputFingerprint:call.fingerprint,claim});
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    let outcome: Record<string,unknown>;
    try {
      const expired = new Promise<never>((_resolve,reject)=>{
        timer=setTimeout(()=>{reject(new ProductizationToolRefusal("OUTCOME_UNKNOWN"));controller.abort();},remaining);
      });
      const answer = await Promise.race([Promise.resolve().then(()=>this.executeBoundary(request,controller.signal)),expired]);
      this.fresh();
      if (controller.signal.aborted || this.clock() >= claim.claimExpiresAt || this.clock() >= ctx.authority.expiresAt) refuse("OUTCOME_UNKNOWN");
      outcome = rec(answer,["status"],["value"]);
      if (outcome.status !== "SUCCEEDED" && outcome.status !== "REFUSED_BEFORE_EFFECT") refuse("OUTCOME_UNKNOWN");
      if (outcome.status === "SUCCEEDED" && !has(outcome,"value")) refuse("OUTCOME_UNKNOWN");
      if (outcome.status === "REFUSED_BEFORE_EFFECT" && has(outcome,"value")) refuse("OUTCOME_UNKNOWN");
    } catch { return this.lock("OUTCOME_UNKNOWN"); }
    finally { if (timer !== undefined) clearTimeout(timer); }
    if (outcome.status === "REFUSED_BEFORE_EFFECT") {
      let finalized: unknown;
      try { finalized = await this.fail({operationKey:ctx.operationId,authority:ctx.authority,
        claimToken:claim.claimToken,claimEpoch:claim.claimEpoch,errorText:"TRUSTED_EXECUTOR_REFUSED_BEFORE_EFFECT"}); }
      catch { return this.lock("STORAGE_FAILURE"); }
      this.verifyFinal(finalized,claim,"FAILED");
      return refuse("EXECUTOR_REFUSED");
    }
    let stored: ToolJson;
    try { const value=json(outcome.value);
      stored=json({schemaVersion:RESULT_SCHEMA,toolName:call.binding.name,bindingRevision:call.binding.revision,
        productHash:call.productHash,fingerprint:call.fingerprint,outputFingerprint:outputHash(call,value),value}); }
    catch { return this.lock("OUTCOME_UNKNOWN"); }
    // Completion failure may mean COMMIT succeeded and acknowledgement was lost.
    // Never follow it with failOperation, another execute or a new operation ID.
    let finalized: unknown;
    try { finalized=await this.complete({operationKey:ctx.operationId,authority:ctx.authority,
      claimToken:claim.claimToken,claimEpoch:claim.claimEpoch,value:stored}); }
    catch { return this.lock("STORAGE_FAILURE"); }
    this.verifyFinal(finalized,claim,"COMPLETED");
    return json((stored as Record<string,ToolJson>).value);
  }
  private verifyFinal(value: unknown, claim: OperationExecutionRecord, status: "COMPLETED"|"FAILED"): void {
    this.fresh();
    try {
      const v=rec(value,["ok","status","reasonCode"],["record"]);
      if (v.ok !== true || v.status !== status || v.reasonCode !== "ok") return this.lock("FINALIZE_REFUSED");
      const r=rec(v.record,RECORD_FIELDS,["finishedAt"]);
      for(const key of RECORD_FIELDS) {
        if(key === "status" || key === "updatedAt") continue;
        if(r[key] !== (claim as unknown as Record<string,unknown>)[key]) refuse("RECEIPT_INVALID");
      }
      if(r.status !== status || integer(r.finishedAt) !== r.updatedAt || Number(r.updatedAt) < claim.createdAt ||
          Number(r.updatedAt) >= claim.claimExpiresAt) refuse("RECEIPT_INVALID");
    } catch(error) {
      if (error instanceof ProductizationToolRefusal && error.reasonCode === "FINALIZE_REFUSED") throw error;
      return this.lock("RECEIPT_INVALID");
    }
  }
}
