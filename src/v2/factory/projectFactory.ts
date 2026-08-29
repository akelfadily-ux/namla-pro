/**
 * Controlled Project Factory (§13, P0.7, P0.12).
 *
 * Generates project template structures for 7 executable project classes:
 * 1. TypeScript Library
 * 2. CLI Application
 * 3. REST API
 * 4. Web Application
 * 5. Full-Stack Application
 * 6. Database-Backed Service
 * 7. Dockerized Service
 */

export type ProjectClass =
  | "TYPESCRIPT_LIBRARY"
  | "CLI_APPLICATION"
  | "REST_API"
  | "WEB_APPLICATION"
  | "FULLSTACK_APPLICATION"
  | "DATABASE_SERVICE"
  | "DOCKERIZED_SERVICE";

export interface ProjectTemplate {
  readonly projectClass: ProjectClass;
  readonly name: string;
  readonly files: ReadonlyArray<{
    readonly relativePath: string;
    readonly content: string;
  }>;
  readonly defaultCommands: readonly string[];
}

export class ProjectFactory {
  public createProjectTemplate(projectClass: ProjectClass, name: string): ProjectTemplate {
    const cleanName = name.replace(/[^a-zA-Z0-9]/g, "_");

    switch (projectClass) {
      case "TYPESCRIPT_LIBRARY":
        return {
          projectClass,
          name,
          files: [
            {
              relativePath: "package.json",
              content: JSON.stringify(
                {
                  name,
                  version: "1.0.0",
                  main: "dist/index.js",
                  scripts: { build: "node -v", test: "node --test" },
                },
                null,
                2
              ),
            },
            {
              relativePath: "src/index.ts",
              content: `export function executeTask(): string {\n  return "Task ready";\n}\nexport function ${cleanName}(): string {\n  return "Library ${name} ready";\n}\n`,
            },
            {
              relativePath: "tests/index.test.ts",
              content: `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { executeTask, ${cleanName} } from "../src/index.ts";\n\ntest("library output", () => {\n  assert.equal(typeof executeTask(), "string");\n  assert.equal(${cleanName}(), "Library ${name} ready");\n});\n`,
            },
          ],
          defaultCommands: ["npm run build", "npm test"],
        };

      case "CLI_APPLICATION":
        return {
          projectClass,
          name,
          files: [
            {
              relativePath: "package.json",
              content: JSON.stringify(
                {
                  name,
                  version: "1.0.0",
                  bin: { [name]: "bin/cli.js" },
                  scripts: { build: "node -v", test: "node --test" },
                },
                null,
                2
              ),
            },
            {
              relativePath: "src/cli.ts",
              content: `export function runCli(argv: string[]): string {\n  const cmd = argv[2] ?? "help";\n  return \`CLI ${name} command: \${cmd}\`;\n}\n`,
            },
            {
              relativePath: "tests/cli.test.ts",
              content: `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { runCli } from "../src/cli.ts";\n\ntest("cli help command", () => {\n  assert.equal(runCli(["node", "cli.js", "help"]), "CLI ${name} command: help");\n});\n`,
            },
          ],
          defaultCommands: ["npm run build", "npm test"],
        };

      case "REST_API":
        return {
          projectClass,
          name,
          files: [
            {
              relativePath: "package.json",
              content: JSON.stringify(
                {
                  name,
                  version: "1.0.0",
                  scripts: { build: "node -v", test: "node --test" },
                },
                null,
                2
              ),
            },
            {
              relativePath: "src/server.ts",
              content: `export function handleRequest(req: { path: string; method: string }): { statusCode: number; body: unknown } {\n  if (req.path === "/api/v1/health") {\n    return { statusCode: 200, body: { status: "ok", service: "${name}" } };\n  }\n  return { statusCode: 404, body: { error: "Not Found" } };\n}\n`,
            },
            {
              relativePath: "tests/server.test.ts",
              content: `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { handleRequest } from "../src/server.ts";\n\ntest("REST API health endpoint", () => {\n  const res = handleRequest({ path: "/api/v1/health", method: "GET" });\n  assert.equal(res.statusCode, 200);\n});\n`,
            },
          ],
          defaultCommands: ["npm run build", "npm test"],
        };

      case "WEB_APPLICATION":
        return {
          projectClass,
          name,
          files: [
            {
              relativePath: "package.json",
              content: JSON.stringify(
                {
                  name,
                  version: "1.0.0",
                  scripts: { build: "node -v", test: "node --test" },
                },
                null,
                2
              ),
            },
            {
              relativePath: "src/app.ts",
              content: `export function renderApp(props: { title: string }): string {\n  return \`<div id="app"><h1>\${props.title}</h1></div>\`;\n}\n`,
            },
            {
              relativePath: "tests/app.test.ts",
              content: `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { renderApp } from "../src/app.ts";\n\ntest("Web app renders title", () => {\n  const html = renderApp({ title: "${name}" });\n  assert.equal(html.includes("<h1>${name}</h1>"), true);\n});\n`,
            },
          ],
          defaultCommands: ["npm run build", "npm test"],
        };

      case "FULLSTACK_APPLICATION":
        return {
          projectClass,
          name,
          files: [
            {
              relativePath: "package.json",
              content: JSON.stringify(
                {
                  name,
                  version: "1.0.0",
                  scripts: { build: "node -v", test: "node --test" },
                },
                null,
                2
              ),
            },
            {
              relativePath: "src/shared/types.ts",
              content: `export function getUser(id: string) { return { id, username: "user_" + id }; }\nexport function formatUserBadge(user: { id: string; username: string }) { return \`User: \${user.username} (\${user.id})\`; }\n`,
            },
            {
              relativePath: "tests/fullstack.test.ts",
              content: `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { getUser, formatUserBadge } from "../src/shared/types.ts";\n\ntest("Fullstack flow", () => {\n  const u = getUser("42");\n  const badge = formatUserBadge(u);\n  assert.equal(badge, "User: user_42 (42)");\n});\n`,
            },
          ],
          defaultCommands: ["npm run build", "npm test"],
        };

      case "DATABASE_SERVICE":
        return {
          projectClass,
          name,
          files: [
            {
              relativePath: "package.json",
              content: JSON.stringify(
                {
                  name,
                  version: "1.0.0",
                  scripts: { build: "node -v", test: "node --test" },
                },
                null,
                2
              ),
            },
            {
              relativePath: "src/repository.ts",
              content: `export class InMemoryRepository<T extends { id: string }> {\n  private store = new Map<string, T>();\n  public save(entity: T): T { this.store.set(entity.id, entity); return entity; }\n  public findById(id: string): T | undefined { return this.store.get(id); }\n}\n`,
            },
            {
              relativePath: "tests/repository.test.ts",
              content: `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { InMemoryRepository } from "../src/repository.ts";\n\ntest("Database repository CRUD", () => {\n  const repo = new InMemoryRepository<{ id: string; name: string }>();\n  repo.save({ id: "1", name: "item1" });\n  assert.equal(repo.findById("1")?.name, "item1");\n});\n`,
            },
          ],
          defaultCommands: ["npm run build", "npm test"],
        };

      case "DOCKERIZED_SERVICE":
        return {
          projectClass,
          name,
          files: [
            {
              relativePath: "package.json",
              content: JSON.stringify(
                {
                  name,
                  version: "1.0.0",
                  scripts: { build: "node -v", test: "node --test" },
                },
                null,
                2
              ),
            },
            {
              relativePath: "Dockerfile",
              content: `FROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --only=production\nCOPY dist ./dist\nEXPOSE 3000\nCMD ["node", "dist/index.js"]\n`,
            },
            {
              relativePath: "src/index.ts",
              content: `export function serviceInfo(): string {\n  return "Dockerized service ${name} active";\n}\n`,
            },
            {
              relativePath: "tests/index.test.ts",
              content: `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { serviceInfo } from "../src/index.ts";\n\ntest("Dockerized service info", () => {\n  assert.equal(serviceInfo(), "Dockerized service ${name} active");\n});\n`,
            },
          ],
          defaultCommands: ["npm run build", "npm test"],
        };

      default:
        return {
          projectClass,
          name,
          files: [
            {
              relativePath: "src/index.ts",
              content: `export const appName = "${name}";\n`,
            },
          ],
          defaultCommands: ["npm run build", "npm test"],
        };
    }
  }
}
