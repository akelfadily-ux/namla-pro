/**
 * Security proofs for the production workspace staging boundary.
 *
 * No WSL, Docker, BuildKit, provider, network, or shell process is executed.
 *
 * Run:
 *   node --test dist/tools/productionWorkspaceStagerTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { isAbsolute, join, resolve } from "path";

import {
  DEFAULT_PRODUCTION_WORKSPACE_STAGING_LIMITS,
  stageProductionWorkspace,
  type ProductionWorkspaceStagingLimits,
  type ProductionWorkspaceStagingReasonCode,
  type ProductionWorkspaceStagingResult,
} from "../cognitive/productionWorkspaceStager";

const IS_WINDOWS = process.platform === "win32";

function tempWorkspace(tag: string): string {
  return mkdtempSync(resolve(tmpdir(), `namla-stage-${tag}-`));
}

function limits(
  overrides: Partial<ProductionWorkspaceStagingLimits>,
): ProductionWorkspaceStagingLimits {
  return {
    ...DEFAULT_PRODUCTION_WORKSPACE_STAGING_LIMITS,
    ...overrides,
  };
}

function requireSuccess(
  result: ProductionWorkspaceStagingResult,
): Extract<ProductionWorkspaceStagingResult, { readonly ok: true }> {
  if (!result.ok) {
    assert.fail(`Expected staging success, received ${result.reasonCode}`);
  }
  return result;
}

function requireRefusal(
  result: ProductionWorkspaceStagingResult,
  reasonCode: Exclude<ProductionWorkspaceStagingReasonCode, "OK">,
): void {
  if (result.ok) {
    assert.fail(`Expected staging refusal ${reasonCode}, received success`);
  }
  assert.equal(result.reasonCode, reasonCode);
  assert.equal(result.manifest, null);
  assert.equal(result.payload, null);
  assert.equal(result.payloadSha256, null);
}

test("STAGE-01: identical workspace produces deterministic manifest, payload, and hashes", () => {
  const ws = tempWorkspace("deterministic");

  try {
    mkdirSync(join(ws, "nested"));
    writeFileSync(join(ws, "z.txt"), "zeta\n", "utf8");
    writeFileSync(join(ws, "nested", "a.txt"), "alpha\n", "utf8");

    const first = requireSuccess(stageProductionWorkspace(ws));
    const second = requireSuccess(stageProductionWorkspace(ws));

    assert.deepEqual(second.manifest, first.manifest);
    assert.deepEqual(second.payload, first.payload);
    assert.equal(second.payloadSha256, first.payloadSha256);
    assert.equal(second.manifest.treeSha256, first.manifest.treeSha256);

    assert.deepEqual(
      first.manifest.entries.map((entry) => entry.path),
      ["nested", "nested/a.txt", "z.txt"],
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("STAGE-02: arbitrary binary file bytes survive staging exactly", () => {
  const ws = tempWorkspace("binary");

  try {
    const expected = Buffer.from([
      0x00,
      0xff,
      0x01,
      0x02,
      0x7f,
      0x80,
      0x0d,
      0x0a,
    ]);

    writeFileSync(join(ws, "blob.bin"), expected);

    const result = requireSuccess(stageProductionWorkspace(ws));
    const entry = result.manifest.entries.find(
      (candidate) =>
        candidate.kind === "file" && candidate.path === "blob.bin",
    );

    assert.ok(entry);
    assert.equal(entry.kind, "file");

    if (entry.kind !== "file") {
      assert.fail("blob.bin was not represented as a file");
    }

    assert.equal(entry.sizeBytes, expected.length);
    assert.deepEqual(Buffer.from(entry.contentBase64, "base64"), expected);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("STAGE-03: relative, missing, and non-directory workspace roots fail closed", () => {
  requireRefusal(
    stageProductionWorkspace("relative-workspace"),
    "STAGING_WORKSPACE_REFUSED",
  );

  const missing = resolve(
    tmpdir(),
    `namla-stage-missing-${process.pid}-${Date.now()}-${Math.random()}`,
  );

  requireRefusal(
    stageProductionWorkspace(missing),
    "STAGING_WORKSPACE_REFUSED",
  );

  const ws = tempWorkspace("file-root");

  try {
    const file = join(ws, "not-a-directory.txt");
    writeFileSync(file, "x", "utf8");

    requireRefusal(
      stageProductionWorkspace(file),
      "STAGING_WORKSPACE_REFUSED",
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("STAGE-04: a symlink or junction inside the candidate workspace is refused", (t) => {
  const ws = tempWorkspace("inner-link");
  const outside = tempWorkspace("outside-link");

  try {
    const target = join(outside, "target.txt");
    const link = join(ws, "escape.txt");

    writeFileSync(target, "outside", "utf8");

    try {
      symlinkSync(target, link, "file");
    } catch (error) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error
          ? String((error as { code?: unknown }).code)
          : "UNKNOWN";

      t.skip(`host cannot create file symlinks (${code})`);
      return;
    }

    requireRefusal(
      stageProductionWorkspace(ws),
      "STAGING_SYMLINK_REFUSED",
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("STAGE-05: a symlinked or junction workspace root is refused", (t) => {
  const base = tempWorkspace("root-link");
  const actual = join(base, "actual");
  const linked = join(base, "linked");

  try {
    mkdirSync(actual);
    writeFileSync(join(actual, "Dockerfile"), "FROM scratch\n", "utf8");

    try {
      symlinkSync(
        actual,
        linked,
        IS_WINDOWS ? "junction" : "dir",
      );
    } catch (error) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error
          ? String((error as { code?: unknown }).code)
          : "UNKNOWN";

      t.skip(`host cannot create directory links (${code})`);
      return;
    }

    requireRefusal(
      stageProductionWorkspace(linked),
      "STAGING_WORKSPACE_REFUSED",
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("STAGE-06: multiply-linked regular files are refused", (t) => {
  const ws = tempWorkspace("hardlink");

  try {
    const original = join(ws, "original.txt");
    const alias = join(ws, "alias.txt");

    writeFileSync(original, "same inode", "utf8");

    try {
      linkSync(original, alias);
    } catch (error) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error
          ? String((error as { code?: unknown }).code)
          : "UNKNOWN";

      t.skip(`host filesystem cannot create hardlinks (${code})`);
      return;
    }

    requireRefusal(
      stageProductionWorkspace(ws),
      "STAGING_HARDLINK_REFUSED",
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("STAGE-07: filesystem special files are refused when the host can create them", async (t) => {
  if (IS_WINDOWS) {
    t.skip("filesystem Unix-domain socket proof is POSIX-only");
    return;
  }

  const ws = tempWorkspace("special");
  const socketPath = join(ws, "candidate.sock");
  const server = createServer();

  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(socketPath, () => resolveListen());
    });

    requireRefusal(
      stageProductionWorkspace(ws),
      "STAGING_SPECIAL_FILE_REFUSED",
    );
  } finally {
    if (server.listening) {
      await new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      });
    }

    rmSync(ws, { recursive: true, force: true });
  }
});

test("STAGE-08: recursive depth is bounded", () => {
  const ws = tempWorkspace("depth");

  try {
    mkdirSync(join(ws, "a", "b"), { recursive: true });
    writeFileSync(join(ws, "a", "b", "x.txt"), "x", "utf8");

    requireRefusal(
      stageProductionWorkspace(
        ws,
        limits({ maxDepth: 0 }),
      ),
      "STAGING_DEPTH_LIMIT_EXCEEDED",
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("STAGE-09: total entry count is bounded", () => {
  const ws = tempWorkspace("entries");

  try {
    writeFileSync(join(ws, "a.txt"), "a", "utf8");
    writeFileSync(join(ws, "b.txt"), "b", "utf8");

    requireRefusal(
      stageProductionWorkspace(
        ws,
        limits({ maxEntries: 1 }),
      ),
      "STAGING_ENTRY_LIMIT_EXCEEDED",
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("STAGE-10: total file count is bounded", () => {
  const ws = tempWorkspace("files");

  try {
    writeFileSync(join(ws, "a.txt"), "a", "utf8");
    writeFileSync(join(ws, "b.txt"), "b", "utf8");

    requireRefusal(
      stageProductionWorkspace(
        ws,
        limits({ maxFiles: 1 }),
      ),
      "STAGING_FILE_LIMIT_EXCEEDED",
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("STAGE-11: individual file size is bounded before payload creation", () => {
  const ws = tempWorkspace("file-size");

  try {
    writeFileSync(join(ws, "large.bin"), Buffer.alloc(2, 0x41));

    requireRefusal(
      stageProductionWorkspace(
        ws,
        limits({ maxFileBytes: 1 }),
      ),
      "STAGING_FILE_TOO_LARGE",
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("STAGE-12: aggregate raw file bytes are bounded", () => {
  const ws = tempWorkspace("total-size");

  try {
    writeFileSync(join(ws, "a.bin"), Buffer.from([0x41]));
    writeFileSync(join(ws, "b.bin"), Buffer.from([0x42]));

    requireRefusal(
      stageProductionWorkspace(
        ws,
        limits({ maxTotalBytes: 1 }),
      ),
      "STAGING_TOTAL_TOO_LARGE",
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("STAGE-13: serialized staging payload size is independently bounded", () => {
  const ws = tempWorkspace("payload-size");

  try {
    writeFileSync(join(ws, "a.txt"), "a", "utf8");

    requireRefusal(
      stageProductionWorkspace(
        ws,
        limits({ maxPayloadBytes: 1 }),
      ),
      "STAGING_PAYLOAD_TOO_LARGE",
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("STAGE-14: payload contains only portable relative paths, never the host workspace path", () => {
  const ws = tempWorkspace("path-leak");

  try {
    mkdirSync(join(ws, "src"));
    writeFileSync(join(ws, "src", "index.ts"), "export {};\n", "utf8");

    const result = requireSuccess(stageProductionWorkspace(ws));
    const payloadText = result.payload.toString("utf8");

    assert.equal(payloadText.includes(ws), false);
    assert.equal(payloadText.includes(ws.replace(/\\/g, "/")), false);

    for (const entry of result.manifest.entries) {
      assert.equal(isAbsolute(entry.path), false);
      assert.equal(entry.path.includes("\\"), false);
      assert.equal(entry.path.startsWith("../"), false);
      assert.equal(entry.path.includes("/../"), false);
    }
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("STAGE-15: changing file content changes staged cryptographic identity", () => {
  const ws = tempWorkspace("identity");

  try {
    const file = join(ws, "candidate.txt");

    writeFileSync(file, "AAAA", "utf8");
    const first = requireSuccess(stageProductionWorkspace(ws));

    writeFileSync(file, "BBBB", "utf8");
    const second = requireSuccess(stageProductionWorkspace(ws));

    assert.notEqual(
      second.manifest.treeSha256,
      first.manifest.treeSha256,
    );

    assert.notEqual(
      second.payloadSha256,
      first.payloadSha256,
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});