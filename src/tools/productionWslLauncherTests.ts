/**
 * Hermetic security proofs for ProductionWslLauncher.
 *
 * NO real WSL process is executed by this suite.
 *
 * Run:
 *   node --test dist/tools/productionWslLauncherTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  ProductionWslLauncher,
  PRODUCTION_WSL_BUILD_ENTRYPOINT,
  PRODUCTION_WSL_DISTRIBUTION,
  PRODUCTION_WSL_CLEANUP_GRACE_MS,
  PRODUCTION_WSL_MAX_OUTPUT_BYTES,
  PRODUCTION_WSL_USER,
  type ProductionWslLauncherOptions,
  type ProductionWslRunnerInvocation,
  type ProductionWslRunnerResult,
} from "../cognitive/productionWslLauncher";

import type {
  ExecutableResolution,
  ResolveOptions,
  ResolvedExecutable,
} from "../cognitive/trustedExecutableRegistry";

import type {
  WindowsSystemAuthorityResult,
} from "../cognitive/windowsSystemTools";

const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

const SYSTEM_ROOT = "C:\\Windows";
const SYSTEM_DIRECTORY = "C:\\Windows\\System32";
const WSL_COMMAND = "C:\\Windows\\System32\\wsl.exe";

const TRUSTED_ENV = Object.freeze({
  SystemRoot: SYSTEM_ROOT,
  windir: SYSTEM_ROOT,
  SystemDrive: "C:",
  PATH: [
    SYSTEM_DIRECTORY,
    SYSTEM_ROOT,
    "C:\\Windows\\System32\\wbem",
  ].join(";"),
  PATHEXT: ".EXE",
});

function authorityOk(): WindowsSystemAuthorityResult {
  return {
    ok: true,
    reasonCode: "ok",
    value: {
      systemRoot: SYSTEM_ROOT,
      systemDirectory: SYSTEM_DIRECTORY,
      environment: TRUSTED_ENV,
    },
  };
}

function resolvedWsl(
  hash: string = HASH,
  executionAuthorized = false,
  command: string = WSL_COMMAND,
): ResolvedExecutable {
  return {
    id: "wsl",
    command,
    prefixArgs: [],
    realPath: command,
    basename: "wsl.exe",
    version: "",
    hash,
    identity: [],
    provenance: "unprovable-on-platform",
    executionAuthorized,
    authorizationReason: executionAuthorized
      ? "ok"
      : "executable-identity-unpinned",
  };
}

function okResolution(
  value: ResolvedExecutable,
): ExecutableResolution {
  return {
    ok: true,
    value,
    reasonCode: "ok",
  };
}

function successfulRunnerResult(): ProductionWslRunnerResult {
  return {
    status: 0,
    stdout: "ENTRYPOINT_OK",
    stderr: "",
    errorCode: null,
    signal: null,
  };
}

function defaultResolver(
  _id: "wsl",
  opts: ResolveOptions,
): ExecutableResolution {
  if (opts.expectedSha256 === undefined) {
    return okResolution(resolvedWsl(HASH, false));
  }

  return okResolution(resolvedWsl(HASH, true));
}

function defaultOptions(
  overrides: Partial<ProductionWslLauncherOptions> = {},
): ProductionWslLauncherOptions {
  return {
    platform: "win32",
    authorityResolver: () => authorityOk(),
    executableResolver: defaultResolver,
    approvedDigestResolver: () => [HASH],
    executableRevalidator: () => "ok",
    runner: () => successfulRunnerResult(),
    ...overrides,
  };
}

test("WSL-LAUNCH-01: successful launch uses two-phase discovery then exact pin and fixed argv", () => {
  const resolverCalls: ResolveOptions[] = [];
  const invocations: ProductionWslRunnerInvocation[] = [];
  let revalidationCalls = 0;

  const launcher = new ProductionWslLauncher(
    defaultOptions({
      executableResolver: (_id, opts) => {
        resolverCalls.push(opts);

        if (opts.expectedSha256 === undefined) {
          return okResolution(resolvedWsl(HASH, false));
        }

        return okResolution(resolvedWsl(HASH, true));
      },

      executableRevalidator: () => {
        revalidationCalls += 1;
        return "ok";
      },

      runner: (invocation) => {
        invocations.push(invocation);
        return successfulRunnerResult();
      },
    }),
  );

  const payload = Buffer.from("trusted-stage-payload", "utf8");
  const result = launcher.launchBuildPayload(payload, 12_345);

  assert.equal(result.success, true);
  assert.equal(result.reasonCode, "OK");
  assert.equal(result.exitCode, 0);

  assert.equal(resolverCalls.length, 2);

  const discovery = resolverCalls[0];
  assert.equal(discovery.searchPath, SYSTEM_DIRECTORY);
  assert.equal(discovery.platform, "win32");
  assert.equal(discovery.probeVersion, false);
  assert.equal(discovery.computeHash, true);
  assert.equal(discovery.requireIdentityPin, false);
  assert.equal(discovery.expectedSha256, undefined);
  assert.deepEqual(discovery.workspaceRoots, []);

  const pinned = resolverCalls[1];
  assert.equal(pinned.searchPath, SYSTEM_DIRECTORY);
  assert.equal(pinned.platform, "win32");
  assert.equal(pinned.probeVersion, false);
  assert.equal(pinned.computeHash, true);
  assert.equal(pinned.requireIdentityPin, true);
  assert.equal(pinned.expectedSha256, HASH);
  assert.deepEqual(pinned.workspaceRoots, []);

  assert.equal(revalidationCalls, 1);
  assert.equal(invocations.length, 1);

  const invocation = invocations[0];

  assert.equal(invocation.command, WSL_COMMAND);
  assert.equal(invocation.cwd, SYSTEM_DIRECTORY);
  assert.equal(invocation.timeoutMs, 12_345 + PRODUCTION_WSL_CLEANUP_GRACE_MS);
  assert.equal(
    invocation.maxBuffer,
    PRODUCTION_WSL_MAX_OUTPUT_BYTES,
  );

  assert.deepEqual(invocation.env, TRUSTED_ENV);
  assert.deepEqual(invocation.input, payload);

  assert.deepEqual(invocation.args, [
    "--distribution",
    PRODUCTION_WSL_DISTRIBUTION,
    "--user",
    PRODUCTION_WSL_USER,
    "--exec",
    PRODUCTION_WSL_BUILD_ENTRYPOINT,
    "--timeout-ms",
    "12345",
  ]);
});

test("WSL-LAUNCH-02: non-Windows platforms refuse before authority, resolution, or spawn", () => {
  let authorityCalls = 0;
  let resolverCalls = 0;
  let runnerCalls = 0;

  const launcher = new ProductionWslLauncher({
    platform: "linux",

    authorityResolver: () => {
      authorityCalls += 1;
      return authorityOk();
    },

    executableResolver: (_id, _opts) => {
      resolverCalls += 1;
      return okResolution(resolvedWsl());
    },

    runner: () => {
      runnerCalls += 1;
      return successfulRunnerResult();
    },
  });

  const result = launcher.launchBuildPayload(
    Buffer.from("x"),
    5_000,
  );

  assert.equal(result.success, false);
  assert.equal(result.reasonCode, "WSL_PLATFORM_REFUSED");
  assert.equal(authorityCalls, 0);
  assert.equal(resolverCalls, 0);
  assert.equal(runnerCalls, 0);
});

test("WSL-LAUNCH-03: empty payload refuses before any trusted executable work", () => {
  let authorityCalls = 0;
  let runnerCalls = 0;

  const launcher = new ProductionWslLauncher(
    defaultOptions({
      authorityResolver: () => {
        authorityCalls += 1;
        return authorityOk();
      },

      runner: () => {
        runnerCalls += 1;
        return successfulRunnerResult();
      },
    }),
  );

  const result = launcher.launchBuildPayload(
    Buffer.alloc(0),
    5_000,
  );

  assert.equal(result.success, false);
  assert.equal(result.reasonCode, "WSL_INPUT_REFUSED");
  assert.equal(authorityCalls, 0);
  assert.equal(runnerCalls, 0);
});

test("WSL-LAUNCH-04: invalid timeout refuses before authority or spawn", () => {
  let authorityCalls = 0;
  let runnerCalls = 0;

  const launcher = new ProductionWslLauncher(
    defaultOptions({
      authorityResolver: () => {
        authorityCalls += 1;
        return authorityOk();
      },

      runner: () => {
        runnerCalls += 1;
        return successfulRunnerResult();
      },
    }),
  );

  const result = launcher.launchBuildPayload(
    Buffer.from("x"),
    999,
  );

  assert.equal(result.success, false);
  assert.equal(result.reasonCode, "WSL_TIMEOUT_REFUSED");
  assert.equal(authorityCalls, 0);
  assert.equal(runnerCalls, 0);
});

test("WSL-LAUNCH-05: unprovable Windows system authority starts zero processes", () => {
  let resolverCalls = 0;
  let runnerCalls = 0;

  const launcher = new ProductionWslLauncher(
    defaultOptions({
      authorityResolver: () => ({
        ok: false,
        value: null,
        reasonCode: "system-root-unresolvable",
      }),

      executableResolver: (_id, _opts) => {
        resolverCalls += 1;
        return okResolution(resolvedWsl());
      },

      runner: () => {
        runnerCalls += 1;
        return successfulRunnerResult();
      },
    }),
  );

  const result = launcher.launchBuildPayload(
    Buffer.from("x"),
    5_000,
  );

  assert.equal(result.success, false);
  assert.equal(
    result.reasonCode,
    "WSL_SYSTEM_AUTHORITY_UNAVAILABLE",
  );
  assert.equal(resolverCalls, 0);
  assert.equal(runnerCalls, 0);
});

test("WSL-LAUNCH-06: discovery refusal starts zero processes", () => {
  let runnerCalls = 0;

  const launcher = new ProductionWslLauncher(
    defaultOptions({
      executableResolver: () => ({
        ok: false,
        value: null,
        reasonCode: "executable-not-found",
      }),

      runner: () => {
        runnerCalls += 1;
        return successfulRunnerResult();
      },
    }),
  );

  const result = launcher.launchBuildPayload(
    Buffer.from("x"),
    5_000,
  );

  assert.equal(result.success, false);
  assert.equal(
    result.reasonCode,
    "WSL_EXECUTABLE_DISCOVERY_REFUSED",
  );
  assert.equal(runnerCalls, 0);
});

test("WSL-LAUNCH-07: unpinned discovery is not permitted to arrive execution-authorized", () => {
  let runnerCalls = 0;

  const launcher = new ProductionWslLauncher(
    defaultOptions({
      executableResolver: () =>
        okResolution(resolvedWsl(HASH, true)),

      runner: () => {
        runnerCalls += 1;
        return successfulRunnerResult();
      },
    }),
  );

  const result = launcher.launchBuildPayload(
    Buffer.from("x"),
    5_000,
  );

  assert.equal(result.success, false);
  assert.equal(
    result.reasonCode,
    "WSL_DISCOVERY_UNEXPECTEDLY_AUTHORIZED",
  );
  assert.equal(runnerCalls, 0);
});

test("WSL-LAUNCH-08: discovery outside proven System32 is refused", () => {
  let runnerCalls = 0;

  const launcher = new ProductionWslLauncher(
    defaultOptions({
      executableResolver: () =>
        okResolution(
          resolvedWsl(
            HASH,
            false,
            "C:\\attacker\\wsl.exe",
          ),
        ),

      runner: () => {
        runnerCalls += 1;
        return successfulRunnerResult();
      },
    }),
  );

  const result = launcher.launchBuildPayload(
    Buffer.from("x"),
    5_000,
  );

  assert.equal(result.success, false);
  assert.equal(
    result.reasonCode,
    "WSL_EXECUTABLE_DISCOVERY_REFUSED",
  );
  assert.equal(runnerCalls, 0);
});

test("WSL-LAUNCH-09: an installed WSL hash absent from repository allowlist is refused", () => {
  let resolverCalls = 0;
  let runnerCalls = 0;

  const launcher = new ProductionWslLauncher(
    defaultOptions({
      executableResolver: (_id, opts) => {
        resolverCalls += 1;

        assert.equal(
          opts.expectedSha256,
          undefined,
          "pin phase must never begin for an unapproved discovery",
        );

        return okResolution(resolvedWsl(HASH, false));
      },

      approvedDigestResolver: () => [OTHER_HASH],

      runner: () => {
        runnerCalls += 1;
        return successfulRunnerResult();
      },
    }),
  );

  const result = launcher.launchBuildPayload(
    Buffer.from("x"),
    5_000,
  );

  assert.equal(result.success, false);
  assert.equal(
    result.reasonCode,
    "WSL_EXECUTABLE_UNAPPROVED",
  );
  assert.equal(resolverCalls, 1);
  assert.equal(runnerCalls, 0);
});

test("WSL-LAUNCH-10: failure of the exact pinned resolution starts zero processes", () => {
  let resolverCalls = 0;
  let runnerCalls = 0;

  const launcher = new ProductionWslLauncher(
    defaultOptions({
      executableResolver: (_id, opts) => {
        resolverCalls += 1;

        if (opts.expectedSha256 === undefined) {
          return okResolution(resolvedWsl(HASH, false));
        }

        return {
          ok: false,
          value: null,
          reasonCode: "hash-mismatch",
        };
      },

      runner: () => {
        runnerCalls += 1;
        return successfulRunnerResult();
      },
    }),
  );

  const result = launcher.launchBuildPayload(
    Buffer.from("x"),
    5_000,
  );

  assert.equal(result.success, false);
  assert.equal(
    result.reasonCode,
    "WSL_EXECUTABLE_PIN_REFUSED",
  );
  assert.equal(resolverCalls, 2);
  assert.equal(runnerCalls, 0);
});

test("WSL-LAUNCH-11: identity substitution between discovery and pinned resolution is refused", () => {
  let resolverCalls = 0;
  let runnerCalls = 0;

  const launcher = new ProductionWslLauncher(
    defaultOptions({
      executableResolver: (_id, opts) => {
        resolverCalls += 1;

        if (opts.expectedSha256 === undefined) {
          return okResolution(resolvedWsl(HASH, false));
        }

        return okResolution(
          resolvedWsl(
            OTHER_HASH,
            true,
            WSL_COMMAND,
          ),
        );
      },

      runner: () => {
        runnerCalls += 1;
        return successfulRunnerResult();
      },
    }),
  );

  const result = launcher.launchBuildPayload(
    Buffer.from("x"),
    5_000,
  );

  assert.equal(result.success, false);
  assert.equal(result.reasonCode, "WSL_EXECUTABLE_CHANGED");
  assert.equal(resolverCalls, 2);
  assert.equal(runnerCalls, 0);
});

test("WSL-LAUNCH-12: a correctly pinned but execution-unauthorized WSL starts zero processes", () => {
  let resolverCalls = 0;
  let runnerCalls = 0;

  const launcher = new ProductionWslLauncher(
    defaultOptions({
      executableResolver: (_id, opts) => {
        resolverCalls += 1;

        if (opts.expectedSha256 === undefined) {
          return okResolution(resolvedWsl(HASH, false));
        }

        return okResolution(resolvedWsl(HASH, false));
      },

      runner: () => {
        runnerCalls += 1;
        return successfulRunnerResult();
      },
    }),
  );

  const result = launcher.launchBuildPayload(
    Buffer.from("x"),
    5_000,
  );

  assert.equal(result.success, false);
  assert.equal(
    result.reasonCode,
    "WSL_EXECUTION_UNAUTHORIZED",
  );
  assert.equal(resolverCalls, 2);
  assert.equal(runnerCalls, 0);
});

test("WSL-LAUNCH-13: final executable revalidation failure blocks spawn", () => {
  let runnerCalls = 0;
  let revalidationCalls = 0;

  const launcher = new ProductionWslLauncher(
    defaultOptions({
      executableRevalidator: () => {
        revalidationCalls += 1;
        return "executable-identity-changed";
      },

      runner: () => {
        runnerCalls += 1;
        return successfulRunnerResult();
      },
    }),
  );

  const result = launcher.launchBuildPayload(
    Buffer.from("x"),
    5_000,
  );

  assert.equal(result.success, false);
  assert.equal(
    result.reasonCode,
    "WSL_EXECUTABLE_REVALIDATION_REFUSED",
  );
  assert.equal(revalidationCalls, 1);
  assert.equal(runnerCalls, 0);
});

for (const scenario of [
  {
    name: "timeout",
    runner: {
      status: null,
      stdout: "",
      stderr: "",
      errorCode: "ETIMEDOUT",
      signal: "SIGTERM",
    } satisfies ProductionWslRunnerResult,
    expected: "WSL_PROCESS_TIMEOUT",
  },
  {
    name: "output overflow",
    runner: {
      status: null,
      stdout: "",
      stderr: "",
      errorCode: "ENOBUFS",
      signal: null,
    } satisfies ProductionWslRunnerResult,
    expected: "WSL_OUTPUT_LIMIT_EXCEEDED",
  },
  {
    name: "generic process error",
    runner: {
      status: null,
      stdout: "",
      stderr: "spawn failed",
      errorCode: "EACCES",
      signal: null,
    } satisfies ProductionWslRunnerResult,
    expected: "WSL_PROCESS_ERROR",
  },
] as const) {
  test(`WSL-LAUNCH-14: ${scenario.name} is mapped to a fixed fail-closed reason`, () => {
    let runnerCalls = 0;

    const launcher = new ProductionWslLauncher(
      defaultOptions({
        runner: () => {
          runnerCalls += 1;
          return scenario.runner;
        },
      }),
    );

    const result = launcher.launchBuildPayload(
      Buffer.from("x"),
      5_000,
    );

    assert.equal(result.success, false);
    assert.equal(result.reasonCode, scenario.expected);
    assert.equal(runnerCalls, 1);
  });
}

test("WSL-LAUNCH-15: nonzero Linux entrypoint exit remains a failed build boundary", () => {
  const launcher = new ProductionWslLauncher(
    defaultOptions({
      runner: () => ({
        status: 23,
        stdout: "partial",
        stderr: "entrypoint failed",
        errorCode: null,
        signal: null,
      }),
    }),
  );

  const result = launcher.launchBuildPayload(
    Buffer.from("x"),
    5_000,
  );

  assert.equal(result.success, false);
  assert.equal(result.reasonCode, "WSL_EXIT_NONZERO");
  assert.equal(result.exitCode, 23);
  assert.equal(result.stdout, "partial");
  assert.equal(result.stderr, "entrypoint failed");
});

test("WSL-LAUNCH-16: this hermetic suite never executes a real WSL process", () => {
  let runnerCalls = 0;

  const launcher = new ProductionWslLauncher(
    defaultOptions({
      executableResolver: () => ({
        ok: false,
        value: null,
        reasonCode: "executable-not-found",
      }),

      runner: () => {
        runnerCalls += 1;
        return successfulRunnerResult();
      },
    }),
  );

  launcher.launchBuildPayload(
    Buffer.from("proof"),
    5_000,
  );

  assert.equal(runnerCalls, 0);
});