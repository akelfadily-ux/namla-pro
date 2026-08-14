/**
 * rolePicker chooses which AntRole a task should be routed to, based on the
 * task's text. Matching is keyword-based and deterministic: rules are
 * checked in order, first match wins, and a task that matches nothing falls
 * back to the generic "worker" role.
 *
 * RULE ORDER IS LOAD-BEARING. The order below is verified against every
 * task shape the DecompositionEngine generates:
 * - "messenger" precedes "auditor" and "memory", because the mission report
 *   task mentions "receipts to review".
 * - "auditor" precedes "builder" and "tester", because the audit task
 *   mentions "the build and verification proposals".
 * - "planner" deliberately has no bare "plan for" keyword, because the
 *   verification-plan task title contains "plan for" but belongs to tester.
 *
 * This is intentionally simple. The picker assigns responsibility; it grants
 * no capability — whatever role is picked, the task still passes through
 * SafetyGuard and the router, and no role can execute anything in Phase 2.
 */

import type { AntRole } from "../types/antTypes";

interface RoleRule {
  role: AntRole;
  keywords: string[];
}

/** Checked top to bottom; first matching rule wins. */
const ROLE_RULES: RoleRule[] = [
  { role: "guard", keywords: ["safety check", "danger", "guard", "classify risk"] },
  { role: "messenger", keywords: ["report to the human", "report mission", "notify", "summarize for"] },
  { role: "scout", keywords: ["investigate", "explore", "inspect", "survey", "observe"] },
  { role: "planner", keywords: ["decompose", "break down", "sequence", "plan the approach"] },
  { role: "auditor", keywords: ["audit", "review", "findings"] },
  { role: "builder", keywords: ["build", "construct", "implement", "propose code", "draft the"] },
  { role: "tester", keywords: ["test", "verify", "verification", "validate"] },
  { role: "memory", keywords: ["memory", "receipt", "remember", "record for later"] },
  { role: "strategist", keywords: ["roadmap", "strategy", "long-term", "direction"] },
  { role: "repair", keywords: ["fix", "repair", "patch"] },
];

export function pickRole(taskText: string): AntRole {
  const lowered = taskText.toLowerCase();

  for (const rule of ROLE_RULES) {
    if (rule.keywords.some((keyword) => lowered.includes(keyword))) {
      return rule.role;
    }
  }

  return "worker";
}
