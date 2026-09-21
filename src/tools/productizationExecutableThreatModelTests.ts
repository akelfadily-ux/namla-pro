import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resolveTrustedExecutable,
} from "../cognitive/trustedExecutableRegistry";

function fixture(): {
  readonly dir: string;
  readonly executable: string;
  readonly sha256: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "namla-c7-exe-"));
  const executable = join(
    dir,
    process.platform === "win32" ? "docker.exe" : "docker",
  );

  writeFileSync(
    executable,
    "NAMLA C7 inert executable fixture\n",
    { mode: 0o755 },
  );

  if (process.platform !== "win32") {
    chmodSync(dir, 0o755);
    chmodSync(executable, 0o755);
  }

  return {
    dir,
    executable,
    sha256: createHash("sha256")
      .update(readFileSync(executable))
      .digest("hex"),
  };
}

function fakeRunner() {
  const calls: Array<{
    readonly command: string;
    readonly args: readonly string[];
  }> = [];

  return {
    calls,
    run(command: string, args: readonly string[]) {
      calls.push({
        command,
        args: [...args],
      });

      return {
        status: 0,
        stdout: "Docker version C7-test\n",
        failed: false,
      };
    },
  };
}

test(
  "C7 same-UID style candidate cannot satisfy a required external identity without a pin",
  () => {
    const f = fixture();
    try {
      const runner = fakeRunner();

      const result = resolveTrustedExecutable("docker", {
        searchPath: f.dir,
        workspaceRoots: [],
        requireIdentityPin: true,
        probeVersion: true,
        processRunner: runner.run,
      });

      assert.equal(result.ok, false);
      assert.equal(
        result.reasonCode,
        "executable-identity-unpinned",
      );
      assert.equal(runner.calls.length, 0);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  },
);

test(
  "C7 wrong external executable identity is refused before any probe",
  () => {
    const f = fixture();
    try {
      const runner = fakeRunner();

      const result = resolveTrustedExecutable("docker", {
        searchPath: f.dir,
        workspaceRoots: [],
        expectedSha256: "0".repeat(64),
        requireIdentityPin: true,
        probeVersion: true,
        processRunner: runner.run,
      });

      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "hash-mismatch");
      assert.equal(runner.calls.length, 0);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  },
);

test(
  "C7 independently measured matching pin reaches only the injected fake probe",
  () => {
    const f = fixture();
    try {
      const runner = fakeRunner();

      const result = resolveTrustedExecutable("docker", {
        searchPath: f.dir,
        workspaceRoots: [],
        expectedSha256: f.sha256,
        requireIdentityPin: true,
        probeVersion: true,
        processRunner: runner.run,
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;

      assert.equal(result.value.executionAuthorized, true);
      assert.equal(result.value.hash, f.sha256);
      assert.equal(runner.calls.length, 1);
      assert.equal(
        runner.calls[0]?.command,
        result.value.command,
      );
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  },
);

test(
  "C7 workspace exclusion cannot be overridden by a matching external pin",
  () => {
    const f = fixture();
    try {
      const runner = fakeRunner();

      const result = resolveTrustedExecutable("docker", {
        searchPath: f.dir,
        workspaceRoots: [f.dir],
        expectedSha256: f.sha256,
        requireIdentityPin: true,
        probeVersion: true,
        processRunner: runner.run,
      });

      assert.equal(result.ok, false);
      assert.equal(
        result.reasonCode,
        "workspace-local-executable-refused",
      );
      assert.equal(runner.calls.length, 0);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  },
);

test(
  "C7 Productization ledger has fifty explicit decisions and no pending donor path",
  () => {
    const text = readFileSync(
      "docs/consolidation/MASTER_SELECTION_MAP.md",
      "utf8",
    );

    const start = text.indexOf("### Productization");
    const end = text.indexOf("### FINAL-02");

    assert.ok(start >= 0);
    assert.ok(end > start);

    const section = text.slice(start, end);

    const pathRows = section
      .split(/\r?\n/u)
      .filter(
        (line) =>
          line.startsWith("| ") &&
          !line.startsWith("| Path ") &&
          !line.startsWith("|---"),
      );

    assert.equal(pathRows.length, 50);
    assert.equal(
      section.includes("HUMAN_REVIEW_REQUIRED"),
      false,
    );

    assert.match(
      section,
      /src\/application\/namla-loop\.ts.*SUPERSEDED_PARALLEL_RUNTIME_NOT_IMPORTED/u,
    );
    assert.match(
      section,
      /postgresStateRepository\.ts.*REJECTED_SECOND_SCHEMA_AND_AUTHORITY_NOT_IMPORTED/u,
    );
    assert.match(
      section,
      /trustedExecutableTests\.ts.*CANONICAL_RETAINED_DONOR_REGRESSION_DELETIONS_REJECTED/u,
    );
  },
);

test(
  "C7 canonical package and compiler configuration stay selected over donor test-stack changes",
  () => {
    const pkg = JSON.parse(
      readFileSync("package.json", "utf8"),
    ) as {
      readonly scripts?: Record<string, string>;
      readonly dependencies?: Record<string, string>;
    };

    assert.equal(
      pkg.scripts?.["test:v2:real-postgres-release"],
      "node dist/tools/v2RealPostgresReleaseRunner.js",
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        pkg.dependencies ?? {},
        "@electric-sql/pglite",
      ),
      false,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        pkg.dependencies ?? {},
        "pg-mem",
      ),
      false,
    );

    const tsconfig = readFileSync("tsconfig.json", "utf8");
    assert.match(tsconfig, /"target":\s*"ES2020"/u);
    assert.match(tsconfig, /"declaration":\s*true/u);
  },
);
