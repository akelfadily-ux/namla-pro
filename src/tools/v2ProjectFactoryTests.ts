/**
 * V2 Project Factory Tests for 7 Project Classes (P0.7).
 *
 * Verifies that ProjectFactory generates full executable project templates for all 7 classes:
 * 1. TYPESCRIPT_LIBRARY
 * 2. CLI_APPLICATION
 * 3. REST_API
 * 4. WEB_APPLICATION
 * 5. FULLSTACK_APPLICATION
 * 6. DATABASE_SERVICE
 * 7. DOCKERIZED_SERVICE
 *
 * Run: node dist/tools/v2ProjectFactoryTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ProjectFactory, ProjectClass } from "../v2/factory/projectFactory";

test("ProjectFactory: Creates valid templates for all 7 project classes", () => {
  const factory = new ProjectFactory();

  const projectClasses: ProjectClass[] = [
    "TYPESCRIPT_LIBRARY",
    "CLI_APPLICATION",
    "REST_API",
    "WEB_APPLICATION",
    "FULLSTACK_APPLICATION",
    "DATABASE_SERVICE",
    "DOCKERIZED_SERVICE",
  ];

  for (const cls of projectClasses) {
    const template = factory.createProjectTemplate(cls, `test-${cls.toLowerCase()}`);
    assert.equal(template.projectClass, cls);
    assert.equal(template.files.length >= 2, true, `${cls} must generate multiple files`);
    assert.equal(template.files.some((f) => f.relativePath === "package.json"), true, `${cls} must include package.json`);
    assert.equal(template.files.some((f) => f.relativePath.startsWith("tests/")), true, `${cls} must include tests/`);
    assert.equal(template.defaultCommands.length >= 1, true, `${cls} must specify default commands`);
  }
});
