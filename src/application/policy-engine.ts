/**
 * C5 Productization entitlement preflight, NOT an execution permit or sandbox.
 * Raw commands and unbound Git writes remain refused. Resource paths use the
 * retained V2 authority plus a stricter, link-free configured-root admission.
 * The executor must independently enforce kernel/lease/claim/secret/IO policy.
 */
import { lstatSync } from "node:fs";
import { isAbsolute, parse, relative, resolve, sep } from "node:path";
import { types } from "node:util";
import { PermissionDeniedError } from "../domain/errors";
import type { PermissionRequest, GitOperation } from "../domain/types";
import { getCanonicalWorkspaceRoot, resolveWorkspacePath } from "../v2/kernel/workspacePathAuthority";

export type { PermissionRequest, GitOperation };
export interface AntPolicy { readonly permissions: readonly string[]; }
export interface PolicyEngineOptions { readonly workspaceRoot?: string; }
export const PRODUCTIZATION_POLICY_VERSION = 2 as const;

type Reason = "INVALID_INPUT" | "INVALID_GRANT" | "CAPABILITY_DENIED" |
  "RAW_EXECUTION_NOT_SUPPORTED" | "HUMAN_ONLY_GIT" | "GIT_WRITE_BINDING_REQUIRED" |
  "GIT_DESCRIPTOR_REQUIRED" | "GIT_BINDING_MISMATCH" | "WORKSPACE_REQUIRED" |
  "WORKSPACE_CHANGED" | "PATH_REFUSED";
export class ProductizationPolicyRefusal extends PermissionDeniedError {
  constructor(public readonly reasonCode: Reason) {
    super(`Productization policy refused: ${reasonCode}`);
  }
}
function deny(reason: Reason): never { throw new ProductizationPolicyRefusal(reason); }
function checked<T>(fn: () => T): T {
  try { return fn(); }
  catch (error) {
    if (error instanceof ProductizationPolicyRefusal) throw error;
    return deny("INVALID_INPUT");
  }
}
function text(value: unknown, max = 4096): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max ||
      value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) deny("INVALID_INPUT");
  return value;
}
function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== "object" || value === null || types.isProxy(value)) deny("INVALID_INPUT");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) deny("INVALID_INPUT");
  const keys = Reflect.ownKeys(value);
  if (keys.length > required.length + optional.length) deny("INVALID_INPUT");
  const out: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string" || (!required.includes(key) && !optional.includes(key))) deny("INVALID_INPUT");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) deny("INVALID_INPUT");
    out[key] = descriptor.value;
  }
  if (required.some(key => !Object.prototype.hasOwnProperty.call(out, key))) deny("INVALID_INPUT");
  return out;
}
function strings(value: unknown): string[] {
  if (typeof value !== "object" || value === null || types.isProxy(value) || !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype) deny("INVALID_INPUT");
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > 256 ||
      Reflect.ownKeys(value).length !== length + 1) deny("INVALID_INPUT");
  const out: string[] = [];
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) deny("INVALID_INPUT");
    out.push(text(descriptor.value));
  }
  return out;
}
const CAPABILITY = /^[a-z][a-z0-9_-]*(?:[.:][a-z][a-z0-9_-]*)*$/;
function capability(value: unknown): string {
  const result = text(value, 256);
  if (!CAPABILITY.test(result)) deny("INVALID_INPUT");
  return result;
}
function family(cap: string): string { return cap.replace(/^tool:/, "").split(/[.:]/, 1)[0]; }

interface Root { readonly requested: string; readonly canonical: string; readonly dev: bigint; readonly ino: bigint; }
function pinRoot(value: unknown): Root {
  const requested = text(value);
  if (!isAbsolute(requested) || requested.startsWith("\\\\") || requested.startsWith("//")) deny("PATH_REFUSED");
  const absolute = resolve(requested);
  const stat = lstatSync(absolute, {bigint:true});
  if (!stat.isDirectory() || stat.isSymbolicLink()) deny("PATH_REFUSED");
  const canonical = getCanonicalWorkspaceRoot(absolute);
  if (canonical === parse(canonical).root || canonical.split(/[\\/]/).some(part => part.toLowerCase() === ".git")) deny("PATH_REFUSED");
  return Object.freeze({ requested: absolute, canonical, dev: stat.dev, ino: stat.ino });
}
function activeRoot(root: Root | undefined): Root {
  if (!root) deny("WORKSPACE_REQUIRED");
  const stat = lstatSync(root.requested, {bigint:true});
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== root.dev || stat.ino !== root.ino ||
      getCanonicalWorkspaceRoot(root.requested) !== root.canonical) deny("WORKSPACE_CHANGED");
  return root;
}
/** Admission syntax only. Do not normalize traversal away before checking it. */
function pathText(value: unknown): string {
  const raw = text(value);
  if (raw.startsWith("\\\\") || raw.startsWith("//")) deny("PATH_REFUSED");
  const normalized = raw.replace(/\\/g, "/");
  const drive = /^[A-Za-z]:\//.test(normalized);
  if (drive && process.platform !== "win32") deny("PATH_REFUSED");
  const body = drive ? normalized.slice(3) : normalized.replace(/^\//, "");
  if (body === ".") return normalized;
  const parts = body.split("/");
  if (parts.some(part => !part || part === "." || part === ".." || /[<>:"|?*%]/.test(part) ||
      /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) deny("PATH_REFUSED");
  return normalized;
}
function insideRelative(root: string, target: string): string | null {
  const rel = relative(root, target);
  return isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep) ? null : rel;
}
/**
 * No filesystem effects. Links/junctions and special files below the root are
 * refused, including dangling links. This observation is NOT race-free IO.
 */
function scopedPath(binding: Root, value: unknown): string {
  const root = activeRoot(binding);
  const name = pathText(value);
  let rel = name;
  if (isAbsolute(name)) {
    rel = insideRelative(root.requested, name) ?? insideRelative(root.canonical, name) ?? deny("PATH_REFUSED");
  }
  const parts = rel.replace(/\\/g, "/").split("/").filter(part => part && part !== ".");
  if (parts.some(part => part.toLowerCase() === ".git")) deny("PATH_REFUSED");
  let at = root.canonical;
  for (let i = 0; i < parts.length; i++) {
    at = resolve(at, parts[i]);
    let stat;
    try { stat = lstatSync(at); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) ||
        (i < parts.length - 1 && !stat.isDirectory())) deny("PATH_REFUSED");
  }
  const result = resolveWorkspacePath(root.canonical, parts.join("/") || ".");
  if (result.ok !== true || result.canonicalWorkspaceRoot !== root.canonical ||
      result.canonicalPath.split(/[\\/]/).some(part => part.toLowerCase() === ".git")) deny("PATH_REFUSED");
  return result.absolutePath;
}

/** The legacy one-argument, ambient-cwd form is deliberately refused in C5. */
export function canonicalizePath(targetPath: string, workspaceRoot?: string): string {
  return checked(() => scopedPath(pinRoot(workspaceRoot ?? deny("WORKSPACE_REQUIRED")), targetPath));
}

type Grant = { kind: "all" } | { kind: "cap"; value: string } | { kind: "prefix"; value: string } |
  { kind: "path"; capability: string; base: string; mode: "exact" | "child" | "descendant" | "all" };
function parseGrant(value: string): Grant {
  if (value === "*") return { kind: "all" };
  const resource = /^((?:tool:)?filesystem[.:][a-z][a-z0-9_-]*):(.+)$/.exec(value);
  if (resource) {
    let base = resource[2].replace(/\\/g, "/");
    if (base === "*" || base === "**") return { kind: "path", capability: resource[1], base: ".", mode: "all" };
    let mode: "exact" | "child" | "descendant" = "exact";
    if (base.endsWith("/**")) { mode = "descendant"; base = base.slice(0, -3); }
    else if (base.endsWith("/*")) { mode = "child"; base = base.slice(0, -2); }
    pathText(base);
    return { kind: "path", capability: resource[1], base, mode };
  }
  if (value.endsWith(":*") || value.endsWith(".*")) {
    capability(value.slice(0, -2));
    return { kind: "prefix", value: value.slice(0, -1) };
  }
  if (!CAPABILITY.test(value) || value.length > 256) deny("INVALID_GRANT");
  return { kind: "cap", value };
}
interface ReadGit { readonly kind: "status" | "log" | "diff"; readonly count?: number; readonly target?: string; }
function readGit(value: unknown): ReadGit {
  const op = record(value, ["kind"], ["action", "count", "target", "message", "name", "branch", "create"]);
  if (op.kind === "forbidden") deny("HUMAN_ONLY_GIT");
  if (op.kind === "commit" || op.kind === "branch" || op.kind === "checkout") deny("GIT_WRITE_BINDING_REQUIRED");
  if (op.kind === "status") { record(value, ["kind"]); return {kind:"status"}; }
  if (op.kind === "log") {
    record(value, ["kind"], ["count"]);
    if (op.count === undefined) return {kind:"log"};
    if (typeof op.count !== "number" || !Number.isSafeInteger(op.count) || op.count < 1 || op.count > 1000) deny("INVALID_INPUT");
    return {kind:"log",count:op.count};
  }
  if (op.kind === "diff") {
    record(value, ["kind"], ["target"]);
    if (op.target === undefined) return {kind:"diff"};
    if (typeof op.target !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(op.target)) deny("INVALID_INPUT");
    return {kind:"diff",target:op.target};
  }
  return deny("HUMAN_ONLY_GIT");
}

export class PolicyEngine {
  private readonly root: Root | undefined;
  constructor(options: PolicyEngineOptions = {}) {
    this.root = checked(() => {
      const config = record(options, [], ["workspaceRoot"]);
      return config.workspaceRoot === undefined ? undefined : pinRoot(config.workspaceRoot);
    });
  }
  /** Descriptor admission only; does not check permissions, Git refs or run Git. */
  authorizeGitOperation(operation: GitOperation): void { checked(() => { readGit(operation); }); }

  /** A successful return is only an entitlement preflight, never a kernel permit. */
  authorize(policy: AntPolicy, request: PermissionRequest, gitOp?: GitOperation): void {
    checked(() => {
      const config = record(policy, ["permissions"]);
      const grants = strings(config.permissions).map(parseGrant);
      const req = record(request, ["capability"], ["resource", "gitOperation"]);
      const cap = capability(req.capability);
      if (req.resource !== undefined) text(req.resource);
      const category = family(cap);
      // No shell-text parser or success-by-absence-of-a-dangerous-token shortcut.
      if (["shell", "command", "process", "exec", "docker", "github"].includes(category)) deny("RAW_EXECUTION_NOT_SUPPORTED");
      const supplied = req.gitOperation === undefined ? undefined : readGit(req.gitOperation);
      const argument = gitOp === undefined ? undefined : readGit(gitOp);
      if (supplied && argument && JSON.stringify(supplied) !== JSON.stringify(argument)) deny("GIT_BINDING_MISMATCH");
      const operation = supplied ?? argument;
      if (category === "git") {
        activeRoot(this.root);
        if (!operation) deny("GIT_DESCRIPTOR_REQUIRED");
        if (req.resource !== undefined) deny("RAW_EXECUTION_NOT_SUPPORTED");
        const base = cap.startsWith("tool:") ? "tool:git" : "git";
        if (cap !== base && cap !== base + "." + operation.kind && cap !== base + ":" + operation.kind) deny("GIT_BINDING_MISMATCH");
      } else if (operation) deny("GIT_BINDING_MISMATCH");
      let target: string | undefined;
      if (category === "filesystem") {
        if (!/^(?:tool:)?filesystem[.:][a-z][a-z0-9_-]*$/.test(cap)) deny("INVALID_INPUT");
        target = scopedPath(activeRoot(this.root), req.resource);
      }
      const matched = grants.some(grant => {
        if (grant.kind === "all") return true;
        if (grant.kind === "cap") return grant.value === cap;
        if (grant.kind === "prefix") return cap.startsWith(grant.value);
        if (grant.capability !== cap || target === undefined) return false;
        if (grant.mode === "all") return true;
        const base = scopedPath(activeRoot(this.root), grant.base);
        if (grant.mode === "exact") return base === target;
        const rel = insideRelative(base, target);
        return rel !== null && rel !== "" && (grant.mode === "descendant" || !rel.includes(sep));
      });
      if (!matched) deny("CAPABILITY_DENIED");
    });
  }
}
