import test from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
} from "node:fs";
import {
  resolve,
} from "node:path";

function releaseRunnerPath(): string {
  return resolve(
    process.cwd(),
    "src",
    "tools",
    "v2RealPostgresReleaseRunner.ts",
  );
}

test(
  "R1B-PG3 release runner includes baseline and execution-authority real PostgreSQL suites",
  () => {
    const source =
      readFileSync(
        releaseRunnerPath(),
        "utf8",
      );

    assert.equal(
      source.includes(
        "dist/tools/v2RealPostgresReleaseTests.js",
      ),
      true,
    );

    assert.equal(
      source.includes(
        "dist/tools/v2RealPostgresExecutionAuthorityTests.js",
      ),
      true,
    );
  },
);

test(
  "C9D2 release runner makes real PostgreSQL process restart/replay mandatory",
  () => {
    const source =
      readFileSync(
        releaseRunnerPath(),
        "utf8",
      );

    assert.equal(
      source.includes(
        "dist/tools/v2RealPostgresCanonicalRestartReplayTests.js",
      ),
      true,
    );
  },
);

test(
  "R1B-PG3 release runner remains DATABASE_URL-gated and fail closed",
  () => {
    const source =
      readFileSync(
        releaseRunnerPath(),
        "utf8",
      );

    assert.equal(
      source.includes(
        "process.env.DATABASE_URL",
      ),
      true,
    );

    assert.equal(
      source.includes(
        "process.exit(1)",
      ),
      true,
    );

    assert.equal(
      source.includes(
        'stdio: "inherit"',
      ),
      true,
    );
  },
);
