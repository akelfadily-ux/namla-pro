import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { test } from "node:test";

/**
 * Mechanically enforces architectural dependency direction using TypeScript AST:
 * Domain (src/domain/**) must NOT import or reference:
 * - src/application/**
 * - src/infrastructure/**
 * - src/interfaces/**
 * - src/bootstrap/**
 * - External SDKs (openai, anthropic, @google/generative-ai, dockerode, pg, fastify, express, react, etc.)
 */
export function checkDomainFileArchitecture(filePath: string, content: string): string[] {
  const violations: string[] = [];
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

  const FORBIDDEN_PATH_PATTERNS = [
    /\/application\b/i,
    /\/infrastructure\b/i,
    /\/interfaces\b/i,
    /\/bootstrap\b/i,
  ];

  const FORBIDDEN_SDKS = [
    "openai",
    "@anthropic-ai/sdk",
    "@google/generative-ai",
    "dockerode",
    "pg",
    "fastify",
    "express",
    "react",
  ];

  function visit(node: ts.Node) {
    let specifier: string | undefined;

    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifier = node.moduleSpecifier.text;
      }
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          specifier = arg.text;
        }
      }
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        specifier = node.argument.literal.text;
      }
    }

    if (specifier) {
      for (const pattern of FORBIDDEN_PATH_PATTERNS) {
        if (pattern.test(specifier)) {
          violations.push(`Forbidden upper layer dependency '${specifier}' in ${filePath}`);
        }
      }

      for (const sdk of FORBIDDEN_SDKS) {
        if (specifier === sdk || specifier.startsWith(`${sdk}/`)) {
          violations.push(`Forbidden external SDK dependency '${specifier}' in ${filePath}`);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function getAllFilesRecursive(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllFilesRecursive(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      files.push(fullPath);
    }
  }
  return files;
}

test("Architecture Layer Isolation AST Validator (Recursive)", () => {
  const domainDir = path.resolve(process.cwd(), "src/domain");
  assert.strictEqual(fs.existsSync(domainDir), true, "src/domain directory must exist");

  const domainFiles = getAllFilesRecursive(domainDir);
  assert.ok(domainFiles.length > 0, "src/domain must contain files");

  for (const fullPath of domainFiles) {
    const relativePath = path.relative(domainDir, fullPath);
    const content = fs.readFileSync(fullPath, "utf8");
    const violations = checkDomainFileArchitecture(relativePath, content);
    assert.deepStrictEqual(violations, [], `Architecture violations in src/domain/${relativePath}:\n${violations.join("\n")}`);
  }
});

test("Architecture Layer Isolation Validator rejects dynamic imports into infrastructure", () => {
  const badContent = `
    export async function loadRepo() {
      const repo = await import("../infrastructure/persistence/postgresStateRepository");
      return repo;
    }
  `;
  const violations = checkDomainFileArchitecture("testFixture.ts", badContent);
  assert.ok(violations.length > 0, "Validator must reject dynamic imports into infrastructure");
  assert.ok(violations[0].includes("../infrastructure/persistence/postgresStateRepository"));
});
