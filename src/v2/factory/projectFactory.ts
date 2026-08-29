/**
 * Controlled Project Factory (§13).
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
                  scripts: { build: "tsc", test: "node --test" },
                },
                null,
                2
              ),
            },
            {
              relativePath: "src/index.ts",
              content: `export function ${name.replace(/[^a-zA-Z0-9]/g, "_")}() {\n  return "Hello from ${name}";\n}\n`,
            },
            {
              relativePath: "tests/index.test.ts",
              content: `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { ${name.replace(/[^a-zA-Z0-9]/g, "_")} } from "../src/index";\n\ntest("library returns expected string", () => {\n  assert.ok(${name.replace(/[^a-zA-Z0-9]/g, "_")}().includes("${name}"));\n});\n`,
            },
          ],
          defaultCommands: ["npx tsc --noEmit", "npm test"],
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
                },
                null,
                2
              ),
            },
            {
              relativePath: "src/cli.ts",
              content: `#!/usr/bin/env node\nconsole.log("Executing CLI: ${name}");\n`,
            },
          ],
          defaultCommands: ["npx tsc --noEmit"],
        };

      case "REST_API":
        return {
          projectClass,
          name,
          files: [
            {
              relativePath: "src/server.ts",
              content: `export interface Route { path: string; method: string; }\nexport const routes: Route[] = [{ path: "/health", method: "GET" }];\n`,
            },
          ],
          defaultCommands: ["npx tsc --noEmit"],
        };

      case "DOCKERIZED_SERVICE":
        return {
          projectClass,
          name,
          files: [
            {
              relativePath: "Dockerfile",
              content: `FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nCMD ["node", "dist/index.js"]\n`,
            },
            {
              relativePath: "src/index.ts",
              content: `console.log("Containerized service running: ${name}");\n`,
            },
          ],
          defaultCommands: ["npx tsc --noEmit"],
        };

      default:
        return {
          projectClass,
          name,
          files: [
            {
              relativePath: "src/index.ts",
              content: `// Generic ${projectClass} template for ${name}\nexport const appName = "${name}";\n`,
            },
          ],
          defaultCommands: ["npx tsc --noEmit"],
        };
    }
  }
}
