/** C1 donor-contract regression checks. These are not runtime authorization. */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import {
  assertRunTransition, assertTaskTransition,
  InvalidRunTransitionError, InvalidTaskTransitionError,
} from "../domain/lifecycle";
import { RunStatus, TaskStatus } from "../domain/types";
import { ModelProviderError, ProviderBillingState } from "../domain/errors";

// Independent table of the reviewed donor's typed transitions. A transition
// being permitted here does not prove evidence, ownership, persistence or gates.
const TASK_EDGES: Readonly<Record<string, readonly string[]>> = {
  CREATED: ["ASSIGNED", "BLOCKED", "FAILED", "CANCELLED"],
  ASSIGNED: ["RUNNING", "RETRYING", "CANCELLED", "BLOCKED"],
  RUNNING: ["RUNNING", "TESTING", "BLOCKED", "RETRYING", "FAILED", "CANCELLED"],
  TESTING: ["REVIEW", "RETRYING", "FAILED", "CANCELLED"],
  REVIEW: ["APPROVED", "RETRYING", "FAILED", "CANCELLED"],
  RETRYING: ["ASSIGNED", "BLOCKED", "FAILED", "CANCELLED"],
  BLOCKED: ["ASSIGNED", "CANCELLED", "FAILED"],
  APPROVED: [], FAILED: [], CANCELLED: [],
};
const RUN_EDGES: Readonly<Record<string, readonly string[]>> = {
  CREATED: ["PLANNING", "CANCELLED"],
  PLANNING: ["RUNNING", "FAILED", "CANCELLED"],
  RUNNING: ["PAUSED", "COMPLETED", "FAILED", "CANCELLED"],
  PAUSED: ["RUNNING", "CANCELLED"],
  COMPLETED: [], FAILED: [], CANCELLED: [],
};

/** Static dependency policy for this domain; not a sandbox or proof of purity. */
function dependencyViolations(file: string, content: string, files: ReadonlySet<string>): string[] {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const errors: string[] = [];
  if (source.referencedFiles.length || source.typeReferenceDirectives.length ||
      source.libReferenceDirectives.length) errors.push("reference-directive");

  const check = (specifier: string): void => {
    if (!/^\.\.?\//.test(specifier) || /[\\\u0000?#]/.test(specifier)) {
      errors.push("external-or-noncanonical-dependency");
      return;
    }
    const target = posix.normalize(posix.join(posix.dirname(file), specifier));
    if (target === ".." || target.startsWith("../") || posix.isAbsolute(target)) {
      errors.push("domain-boundary-escape");
      return;
    }
    if (![target, target + ".ts", target + "/index.ts"].some((item) => files.has(item))) {
      errors.push("unresolved-domain-dependency");
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) {
        if (ts.isStringLiteral(node.moduleSpecifier)) check(node.moduleSpecifier.text);
        else errors.push("nonliteral-module-specifier");
      }
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      if (expression && ts.isStringLiteral(expression)) check(expression.text);
      else errors.push("nonliteral-import-equals");
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        check(node.argument.literal.text);
      } else errors.push("nonliteral-import-type");
    } else if (ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
       (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      // Loading modules during domain execution is not part of this batch.
      errors.push("runtime-module-loading");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return errors;
}

function domainSources(root: string, relative = ""): Map<string, string> {
  const found = new Map<string, string>();
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    assert.equal(entry.isSymbolicLink(), false, "Domain sources must not be symlinks");
    if (entry.isDirectory()) {
      for (const [path, content] of domainSources(root, name)) found.set(path, content);
    } else if (/\.tsx?$/.test(entry.name)) {
      assert.ok(entry.isFile(), "Domain sources must be regular files");
      found.set(name, readFileSync(join(root, name), "utf8"));
    }
  }
  return found;
}

test("C1 Productization retains the complete reviewed task transition matrix", () => {
  const states = Object.values(TaskStatus);
  assert.deepEqual([...states].sort(), Object.keys(TASK_EDGES).sort());
  for (const from of states) for (const to of states) {
    const action = () => assertTaskTransition(from, to);
    if (TASK_EDGES[from].includes(to)) assert.doesNotThrow(action, `${from}->${to}`);
    else assert.throws(action, InvalidTaskTransitionError, `${from}->${to}`);
  }
});

test("C1 Productization retains the complete reviewed run transition matrix", () => {
  const states = Object.values(RunStatus);
  assert.deepEqual([...states].sort(), Object.keys(RUN_EDGES).sort());
  for (const from of states) for (const to of states) {
    const action = () => assertRunTransition(from, to);
    if (RUN_EDGES[from].includes(to)) assert.doesNotThrow(action, `${from}->${to}`);
    else assert.throws(action, InvalidRunTransitionError, `${from}->${to}`);
  }
});

test("C1 provider failure retryability never supplies a missing billing classification", () => {
  for (const retryable of [true, false]) {
    const unknown = new ModelProviderError("fixture failure", retryable);
    assert.equal(unknown.billingState, ProviderBillingState.UNKNOWN_BILLING_FAILURE);
    for (const state of Object.values(ProviderBillingState)) {
      const error = new ModelProviderError("fixture failure", retryable, state);
      assert.equal(error.billingState, state);
      assert.equal(error.retryable, retryable);
    }
  }
});

test("C1 domain module dependencies resolve only to domain source files", () => {
  const sources = domainSources(resolve(process.cwd(), "src/domain"));
  assert.ok(sources.size >= 5, "The reviewed domain dependency closure must exist");
  const paths = new Set(sources.keys());
  for (const [path, content] of sources) {
    assert.deepEqual(dependencyViolations(path, content, paths), [], path);
  }
});

test("C1 domain dependency guard rejects escape SDK filesystem and runtime-loading fixtures", () => {
  const paths = new Set(["types.ts", "contracts.ts", "nested/model.ts"]);
  for (const good of [
    'import type { TaskRecord } from "./types";',
    'export type { TaskRecord } from "./types";',
    'type State = import("./contracts").StateRepository;',
  ]) assert.deepEqual(dependencyViolations("fixture.ts", good, paths), []);
  assert.deepEqual(dependencyViolations("nested/model.ts", 'import "../types";', paths), []);
  for (const bad of [
    'import { Pool } from "pg";',
    'import fs from "node:fs";',
    'export * from "../v2/kernel/trustedKernel";',
    'import type { X } from "../application/x";',
    'type X = import("../infrastructure/x").X;',
    'import p = require("pg");',
    'require("./types");',
    'const load = (name: string) => import(name);',
    'const load = (name: string) => require(name);',
    'import "./missing";',
    'import "./nested/../../outside";',
    '/// <reference types="node" />\nexport {};',
  ]) assert.ok(dependencyViolations("fixture.ts", bad, paths).length > 0, bad);
});
