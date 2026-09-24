import test from "node:test";
import assert from "node:assert/strict";

import {
  CANONICAL_FACTORY_ORDER,
  CANONICAL_FACTORY_REGISTRY,
  CANONICAL_FROZEN_PLAN_CONTRACT_BOUNDARY,
} from "../v2/architecture/canonicalPipelineRegistry";

import {
  CANONICAL_FACTORY_SHELL_REGISTRY,
  CANONICAL_RUNTIME_BACKED_FACTORY_IDS,
  CANONICAL_SHELL_ONLY_FACTORY_IDS,
  getCanonicalFactoryShell,
  validateCanonicalFactoryShellRegistry,
} from "../v2/architecture/canonicalFactoryShells";

const EXPECTED_RUNTIME_BACKED = [
  "EER",
  "PLAN",
  "PLAN_TEST",
  "PRO",
  "SON",
  "LEGGO",
  "PROMAX",
  "FINAL_SPRINT_COURT",
  "LIHU",
  "DEVOPS",
  "API_INTEGRATION",
  "SECURITY",
  "NAMLA_LAB",
] as const;

const EXPECTED_SHELL_ONLY = [] as const;

test(
  "10E4 shell registry is one-to-one with the 10E3 canonical factory order",
  () => {
    assert.deepEqual(
      CANONICAL_FACTORY_SHELL_REGISTRY.map(
        (shell) => shell.id,
      ),
      CANONICAL_FACTORY_ORDER,
    );

    assert.equal(
      CANONICAL_FACTORY_SHELL_REGISTRY.length,
      CANONICAL_FACTORY_REGISTRY.length,
    );
  },
);

test(
  "10E4 every shell preserves the exact 10E3 architecture authority object",
  () => {
    for (
      let index = 0;
      index < CANONICAL_FACTORY_REGISTRY.length;
      index += 1
    ) {
      assert.equal(
        CANONICAL_FACTORY_SHELL_REGISTRY[index]?.architecture,
        CANONICAL_FACTORY_REGISTRY[index],
      );
    }
  },
);

test(
  "10E4 runtime-backed capability classification is exact",
  () => {
    assert.deepEqual(
      CANONICAL_RUNTIME_BACKED_FACTORY_IDS,
      EXPECTED_RUNTIME_BACKED,
    );
  },
);

test(
  "10E4 missing canonical runtime implementations are exact",
  () => {
    assert.deepEqual(
      CANONICAL_SHELL_ONLY_FACTORY_IDS,
      EXPECTED_SHELL_ONLY,
    );
  },
);

test(
  "10E4 existing capabilities defer runtime adapter binding to 10E5",
  () => {
    for (
      const id
      of EXPECTED_RUNTIME_BACKED
    ) {
      const shell =
        getCanonicalFactoryShell(id);

      assert.deepEqual(
        shell.implementation,
        {
          kind:
            "EXISTING_CAPABILITY",
          stepperBinding:
            "DEFERRED_TO_10E5",
        },
      );
    }
  },
);

test(
  "C9C3 no canonical factory remains shell-only after atomic activation",
  () => {
    assert.deepEqual(
      CANONICAL_SHELL_ONLY_FACTORY_IDS,
      EXPECTED_SHELL_ONLY,
    );

    assert.equal(
      CANONICAL_SHELL_ONLY_FACTORY_IDS.length,
      0,
    );
  },
);

test(
  "C9C3 PLAN_TEST remains distinct and runtime-backed before the frozen contract boundary",
  () => {
    const plan =
      getCanonicalFactoryShell("PLAN");

    const planTest =
      getCanonicalFactoryShell(
        "PLAN_TEST",
      );

    const pro =
      getCanonicalFactoryShell("PRO");

    assert.notEqual(
      plan.id,
      planTest.id,
    );

    assert.equal(
      planTest.implementation.kind,
      "EXISTING_CAPABILITY",
    );

    assert.equal(
      CANONICAL_FROZEN_PLAN_CONTRACT_BOUNDARY
        .requiredAfterFactory,
      "PLAN_TEST",
    );

    assert.equal(
      CANONICAL_FROZEN_PLAN_CONTRACT_BOUNDARY
        .requiredBeforeFactory,
      "PRO",
    );

    assert.equal(
      pro.architecture.entryAuthority,
      "FROZEN_PLAN_CONTRACT",
    );
  },
);

test(
  "10E4 PROTOCOL and COLONY_AB cannot appear as canonical factory shells",
  () => {
    const shellIds =
      new Set(
        CANONICAL_FACTORY_SHELL_REGISTRY.map(
          (shell) => shell.id as string,
        ),
      );

    assert.equal(
      shellIds.has("PROTOCOL"),
      false,
    );

    assert.equal(
      shellIds.has("COLONY_AB"),
      false,
    );
  },
);

test(
  "10E4 shell registry contains no duplicate identifiers",
  () => {
    const ids =
      CANONICAL_FACTORY_SHELL_REGISTRY.map(
        (shell) => shell.id,
      );

    assert.equal(
      new Set(ids).size,
      ids.length,
    );
  },
);

test(
  "10E4 shell architecture objects and implementation classifications are frozen",
  () => {
    assert.equal(
      Object.isFrozen(
        CANONICAL_FACTORY_SHELL_REGISTRY,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        CANONICAL_RUNTIME_BACKED_FACTORY_IDS,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        CANONICAL_SHELL_ONLY_FACTORY_IDS,
      ),
      true,
    );

    for (
      const shell
      of CANONICAL_FACTORY_SHELL_REGISTRY
    ) {
      assert.equal(
        Object.isFrozen(shell),
        true,
      );

      assert.equal(
        Object.isFrozen(
          shell.implementation,
        ),
        true,
      );
    }
  },
);

test(
  "10E4 canonical factory shell lookup returns the registered immutable shell",
  () => {
    for (
      const shell
      of CANONICAL_FACTORY_SHELL_REGISTRY
    ) {
      assert.equal(
        getCanonicalFactoryShell(
          shell.id,
        ),
        shell,
      );
    }
  },
);

test(
  "10E4 unknown factory shell lookup fails closed",
  () => {
    assert.throws(
      () =>
        getCanonicalFactoryShell(
          "PROTOCOL" as never,
        ),
      /UNKNOWN_CANONICAL_FACTORY_SHELL:PROTOCOL/,
    );
  },
);

test(
  "10E4 built-in shell validator reports no architecture violations",
  () => {
    const validation =
      validateCanonicalFactoryShellRegistry();

    assert.equal(
      validation.ok,
      true,
    );

    assert.deepEqual(
      validation.errors,
      [],
    );

    assert.equal(
      Object.isFrozen(validation),
      true,
    );

    assert.equal(
      Object.isFrozen(
        validation.errors,
      ),
      true,
    );
  },
);
