/**
 * EER Engine (§04, §09).
 */

import { PreFreezeStageContext } from "../types/stageContext";
import { RiskClass } from "../types/contracts";

export interface EerOutput {
  readonly missionId: string;
  readonly originalObjective: string;
  readonly interpretedIntent: string;
  readonly identifiedConstraints: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly securityImplications: readonly string[];
  readonly riskClass: RiskClass;
  readonly unresolvedAmbiguities: readonly string[];
  readonly authoritySensitive: boolean;
}

export interface EerExecutionResult {
  readonly success: boolean;
  readonly eerOutput?: EerOutput;
  readonly humanRequired: boolean;
  readonly reasonCode: string;
}

export class EerEngine {
  public evaluateObjective(
    objective: string,
    context: PreFreezeStageContext
  ): EerExecutionResult {
    if (!objective || objective.trim().length === 0) {
      return {
        success: false,
        humanRequired: false,
        reasonCode: "EMPTY_OBJECTIVE_REFUSED",
      };
    }

    const lowerObj = objective.toLowerCase();

    const isAuthoritySensitive =
      lowerObj.includes("delete production") ||
      lowerObj.includes("drop database") ||
      lowerObj.includes("publish credentials") ||
      lowerObj.includes("override security");

    if (isAuthoritySensitive) {
      return {
        success: false,
        humanRequired: true,
        reasonCode: "AUTHORITY_SENSITIVE_AMBIGUITY_ESCALATED",
        eerOutput: {
          missionId: context.missionId,
          originalObjective: objective,
          interpretedIntent: "High-risk authority-sensitive operation requested",
          identifiedConstraints: ["Requires explicit human authorization gate"],
          requiredCapabilities: ["ADMIN_AUTHORITY"],
          securityImplications: ["Destructive or sensitive action"],
          riskClass: "CRITICAL",
          unresolvedAmbiguities: ["Human authorization not granted"],
          authoritySensitive: true,
        },
      };
    }

    let riskClass: RiskClass = "LOW";
    if (lowerObj.includes("security") || lowerObj.includes("auth") || lowerObj.includes("docker")) {
      riskClass = "HIGH";
    } else if (lowerObj.includes("api") || lowerObj.includes("database") || lowerObj.includes("service")) {
      riskClass = "MEDIUM";
    }

    const capabilities: string[] = ["filesystem.read", "filesystem.write"];
    if (lowerObj.includes("build") || lowerObj.includes("test")) {
      capabilities.push("process.execute");
    }

    const eerOutput: EerOutput = {
      missionId: context.missionId,
      originalObjective: objective,
      interpretedIntent: `Structured engineering mission for: ${objective.trim()}`,
      identifiedConstraints: [
        "Must stay within workspace root",
        "Must pass TypeScript compilation and tests",
      ],
      requiredCapabilities: capabilities,
      securityImplications: [
        "Path traversal containment required",
        "Secret protection policy enforced",
      ],
      riskClass,
      unresolvedAmbiguities: [],
      authoritySensitive: false,
    };

    return {
      success: true,
      eerOutput,
      humanRequired: false,
      reasonCode: "OK",
    };
  }
}
