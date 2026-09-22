import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
} from "node:fs";

import {
  TRUSTED_EXECUTABLE_IDS,
  VERIFICATION_ARGUMENT_TEMPLATES,
  approvedWslExecutableDigests,
} from "../cognitive/trustedExecutableRegistry";

test(
  "C8 FINAL-02 ledger has fifty-six explicit decisions and no pending donor path",
  () => {
    const text = readFileSync(
      "docs/consolidation/MASTER_SELECTION_MAP.md",
      "utf8",
    );

    const start = text.indexOf("### FINAL-02");
    assert.ok(start >= 0);

    const section = text.slice(start);

    const rows = section
      .split(/\r?\n/u)
      .filter(
        (line) =>
          line.startsWith("| ") &&
          !line.startsWith("| Path ") &&
          !line.startsWith("|---"),
      );

    assert.equal(rows.length, 56);
    assert.equal(
      section.includes("HUMAN_REVIEW_REQUIRED"),
      false,
    );
    assert.equal(
      section.includes("DONOR_REVIEW_PENDING"),
      false,
    );
  },
);

test(
  "C8 parallel FINAL-02 runtime entrypoints are not activated in canonical source",
  () => {
    const rejected = [
      "src/twin/final02ExecutionRuntime.ts",
      "src/twin/twinPostColonyPipeline.ts",
      "src/twin/final02/final02Coordinator.ts",
      "src/twin/final02/workspaceManager.ts",
      "src/twin/final02/materializer.ts",
      "src/twin/final02/productionTrustStore.ts",
    ];

    for (const path of rejected) {
      assert.equal(
        existsSync(path),
        false,
        `${path} must remain historical donor source`,
      );
    }
  },
);

test(
  "C8 typecheck remains bound to the image-owned TypeScript compiler",
  () => {
    const entry = VERIFICATION_ARGUMENT_TEMPLATES.typecheck;

    assert.equal(entry.id, "node");
    assert.deepEqual(
      [...entry.args],
      [
        "/opt/namla-toolchain/node_modules/typescript/lib/tsc.js",
        "--noEmit",
      ],
    );
    assert.equal(
      entry.args.some((arg) => arg.includes("/workspace")),
      false,
    );
  },
);

test(
  "C8 smoke and integration verification retain closed Node argv",
  () => {
    const expected = {
      smoke_server: ["--test", "tests/server.test.ts"],
      smoke_cli: ["--test", "tests/cli.test.ts"],
      smoke_repository: ["--test", "tests/repository.test.ts"],
      smoke_app: ["--test", "tests/app.test.ts"],
      smoke_index: ["--test", "tests/index.test.ts"],
      integration: ["--test", "tests/integration.test.ts"],
    } as const;

    for (const [id, args] of Object.entries(expected)) {
      const entry = VERIFICATION_ARGUMENT_TEMPLATES[id];
      assert.ok(entry, id);
      assert.equal(entry.id, "node", id);
      assert.deepEqual([...entry.args], [...args], id);
    }
  },
);

test(
  "C8 canonical trusted executable registry retains Node and reviewed WSL identity roots",
  () => {
    assert.equal(TRUSTED_EXECUTABLE_IDS.includes("node"), true);
    assert.equal(TRUSTED_EXECUTABLE_IDS.includes("wsl"), true);

    const wslDigests = approvedWslExecutableDigests("win32");
    assert.equal(wslDigests.length >= 1, true);

    for (const digest of wslDigests) {
      assert.match(digest, /^[0-9a-f]{64}$/u);
    }

    assert.deepEqual(
      approvedWslExecutableDigests("linux"),
      [],
    );
  },
);

test(
  "C8 canonical merge forge remains free of the donor direct host materialization path",
  () => {
    const source = readFileSync(
      "src/twin/mergeForge.ts",
      "utf8",
    );

    assert.equal(source.includes('from "node:fs"'), false);
    assert.equal(source.includes('from "node:child_process"'), false);
    assert.equal(source.includes("ensureTwinColonyWorkspace"), false);
    assert.equal(source.includes("writeLiveObjectiveFile"), false);
  },
);
