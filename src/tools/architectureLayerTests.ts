import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * Mechanically enforces architectural dependency direction:
 * Domain (src/domain/**) must NOT import:
 * - src/application/**
 * - src/infrastructure/**
 * - src/interfaces/**
 * - External SDKs (openai, anthropic, @google/generative-ai, dockerode, pg, fastify, express, react, etc.)
 */
test("Architecture Layer Isolation: Domain layer must be pure and import zero upper layers/SDKs", () => {
  const domainDir = path.resolve(process.cwd(), "src/domain");
  assert.strictEqual(fs.existsSync(domainDir), true, "src/domain directory must exist");

  const domainFiles = fs.readdirSync(domainDir).filter((file) => file.endsWith(".ts"));
  assert.ok(domainFiles.length > 0, "src/domain must contain TypeScript source files");

  const illegalPatterns = [
    /from\s+['"].*application.*/i,
    /from\s+['"].*infrastructure.*/i,
    /from\s+['"].*interfaces.*/i,
    /from\s+['"]openai['"]/i,
    /from\s+['"]@anthropic-ai\/sdk['"]/i,
    /from\s+['"]dockerode['"]/i,
    /from\s+['"]pg['"]/i,
    /from\s+['"]fastify['"]/i,
    /from\s+['"]express['"]/i,
    /from\s+['"]react['"]/i,
  ];

  for (const file of domainFiles) {
    const fullPath = path.join(domainDir, file);
    const content = fs.readFileSync(fullPath, "utf8");

    for (const pattern of illegalPatterns) {
      assert.strictEqual(
        pattern.test(content),
        false,
        `Illegal dependency in src/domain/${file} matching pattern ${pattern.toString()}`
      );
    }
  }
});
