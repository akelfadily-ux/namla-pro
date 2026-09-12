import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
} from "fs";
import {
  resolve,
} from "path";

const WORKFLOW_RELATIVE =
  ".github/workflows/v2-real-postgres-release.yml";

const POSTGRES_DIGEST =
  "sha256:bb3e1a57e5407e0a5280b4211980a5e537f4abd234a87014ac979849a78dd825";

function workflowPath(): string {
  const candidates = [
    resolve(
      process.cwd(),
      WORKFLOW_RELATIVE,
    ),

    resolve(
      __dirname,
      "..",
      "..",
      WORKFLOW_RELATIVE,
    ),

    resolve(
      __dirname,
      "..",
      "..",
      "..",
      WORKFLOW_RELATIVE,
    ),
  ];

  const found =
    candidates.find(
      existsSync,
    );

  assert.equal(
    typeof found,
    "string",
    "the V2 real PostgreSQL release workflow must exist",
  );

  return found as string;
}

function workflowLines():
  string[] {
  return readFileSync(
    workflowPath(),
    "utf8",
  )
    .split("\n")
    .map(
      (line) =>
        line.endsWith("\r")
          ? line.slice(0, -1)
          : line,
    );
}

test(
  "V2 real PostgreSQL workflow contains no unsafe plain colon-space scalar",
  () => {
    const offenders:
      string[] = [];

    workflowLines()
      .forEach(
        (line, index) => {
          const match =
            /^(\s*)(run|name|if|shell|uses|path):\s+(.*)$/
              .exec(line);

          if (!match) {
            return;
          }

          const value =
            match[3];

          if (
            value.length === 0 ||
            value.startsWith("|") ||
            value.startsWith(">")
          ) {
            return;
          }

          const quoted =
            (
              value.startsWith("\"") &&
              value.endsWith("\"")
            ) ||
            (
              value.startsWith("'") &&
              value.endsWith("'")
            );

          if (
            !quoted &&
            value.includes(": ")
          ) {
            offenders.push(
              `line ${index + 1}: ${value}`,
            );
          }
        },
      );

    assert.deepEqual(
      offenders,
      [],
    );
  },
);

test(
  "V2 real PostgreSQL workflow has one mandatory release job",
  () => {
    const text =
      workflowLines()
        .join("\n");

    assert.equal(
      text.includes(
        "real-postgres-release:",
      ),
      true,
    );

    assert.equal(
      text.includes(
        "npm run test:v2:real-postgres-release",
      ),
      true,
    );

    assert.equal(
      text.includes(
        "postgres:",
      ),
      true,
    );
  },
);

test(
  "V2 real PostgreSQL workflow pins actions and PostgreSQL image identity",
  () => {
    const lines =
      workflowLines();

    const usesLines =
      lines.filter(
        (line) =>
          /^\s*uses:\s+/.test(
            line,
          ),
      );

    assert.ok(
      usesLines.length >= 2,
    );

    for (
      const line
      of usesLines
    ) {
      assert.match(
        line,
        /@[0-9a-f]{40}(?:\s+#.*)?$/,
      );
    }

    const text =
      lines.join("\n");

    assert.equal(
      text.includes(
        `image: postgres@${POSTGRES_DIGEST}`,
      ),
      true,
    );
  },
);

test(
  "V2 real PostgreSQL workflow requires no repository secret and grants no write permission",
  () => {
    const lines =
      workflowLines();

    const text =
      lines.join("\n");

    assert.equal(
      /\$\{\{\s*secrets\./
        .test(text),
      false,
    );

    assert.equal(
      text.includes(
        "contents: read",
      ),
      true,
    );

    assert.equal(
      /\bcontents:\s*write\b/
        .test(text),
      false,
    );

    assert.equal(
      text.includes(
        "persist-credentials: false",
      ),
      true,
    );

    const executable =
      lines
        .filter(
          (line) =>
            !/^\s*#/.test(
              line,
            ),
        )
        .join("\n");

    assert.equal(
      /git\s+push/
        .test(executable),
      false,
    );
  },
);

test(
  "V2 real PostgreSQL workflow uses an ephemeral host port and loopback database URL",
  () => {
    const text =
      workflowLines()
        .join("\n");

    assert.equal(
      text.includes(
        "- 5432/tcp",
      ),
      true,
    );

    assert.equal(
      text.includes(
        "127.0.0.1:${{ job.services.postgres.ports[5432] }}",
      ),
      true,
    );

    assert.equal(
      text.includes(
        "DATABASE_URL:",
      ),
      true,
    );
  },
);