// Focused feature demo — proves the canonical ant role registry (AH2 Step 4A).
// The canonical end-to-end runtime path is demoEndToEnd.ts.
/**
 * demoAntRoleRegistry: reads the canonical role metadata registry and
 * reports what each of the twenty ant roles actually is in the runtime
 * spine. Pure data reporting — no mission runs, no commands, no network,
 * no files, no receipts needed.
 */

import {
  getAntRoleSpec,
  isKnownAntRole,
  listAntRoleSpecs,
  listEngineActiveRoles,
  listFacadeRoles,
} from "../ants/antRoleRegistry";

export function runDemoAntRoleRegistry() {
  const all = listAntRoleSpecs();
  const engineActive = listEngineActiveRoles();
  const facades = listFacadeRoles();
  const futureFacing = all.filter((spec) => spec.category === "future-facing");

  return {
    totalRoleCount: all.length,
    engineActiveRoles: engineActive.map((spec) => spec.role),
    capabilityAndLegacyFacades: facades.map((spec) => ({
      role: spec.role,
      category: spec.category,
      canonicalRuntimeOwner: spec.canonicalRuntimeOwner,
    })),
    futureFacingRoles: futureFacing.map((spec) => spec.role),
    classFileStatusCounts: all.reduce<Record<string, number>>((acc, spec) => {
      acc[spec.classFileStatus] = (acc[spec.classFileStatus] ?? 0) + 1;
      return acc;
    }, {}),
    spotChecks: {
      builderIsEngineActive: getAntRoleSpec("builder").category === "engine-active",
      guardOwnerIsSafetyGuard: getAntRoleSpec("guard").canonicalRuntimeOwner.includes("safetyGuard"),
      unknownRoleRejected: !isKnownAntRole("dragon"),
    },
    guarantees: {
      pureDataOnly: true, // the registry module imports only the AntRole type
      noBehaviorExecuted: true, // nothing here runs a mission or any action
    },
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoAntRoleRegistry(), null, 2));
}
