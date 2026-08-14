/**
 * DesktopActionPlanner builds DesktopActionPlan sequences from a task
 * description — as data only. It imports no OS, input, window, screen, or
 * process API, because none exists in this project to import.
 *
 * Two independent gates refuse a plan before it exists:
 *
 * 1. Protected-surface deny list: any step whose target or input summary
 *    (or the task description itself) mentions a credential prompt, login
 *    form, terminal, system/security settings, signed-in browser session,
 *    deletion/confirmation dialog, payment/banking screen, private
 *    messages, or an email inbox is refused. Matching is by substring and
 *    deliberately over-cautious (e.g. bare "auth" also catches "author");
 *    refusing too much is the safe direction.
 * 2. SafetyGuard over all plan text; RISKY and FORBIDDEN refuse.
 *
 * Refusal receipts follow the established redaction and reason-literal
 * discipline: reason codes, counts, lengths, and fingerprints only — the
 * raw text of a refused plan never enters the receipt log, and summaries
 * never name the protected surface they refused.
 */

import { randomUUID } from "crypto";
import type {
  DesktopActionKind,
  DesktopActionPlan,
  DesktopActionStep,
  DesktopPlanResult,
} from "./desktopActionTypes";
import { SafetyGuard } from "../core/safetyGuard";
import { ReceiptLog } from "../core/receiptLog";
import { fingerprint } from "../core/redaction";

/**
 * Surfaces a bot plan may never target, even in simulation. Substring
 * match, lowercase. This list is deny-list DATA (like SafetyGuard's
 * indicator lists), not receipt text.
 */
const PROTECTED_SURFACE_INDICATORS: string[] = [
  "credential",
  "login",
  "log in",
  "sign-in",
  "sign in",
  "password",
  "passphrase",
  "auth",
  "one-time code",
  "2fa",
  "terminal",
  "shell",
  "command prompt",
  "cmd.exe",
  "powershell",
  "console window",
  "system settings",
  "security",
  "control panel",
  "registry",
  "signed-in",
  "logged-in",
  "browser session",
  "delete",
  "deletion",
  "remove",
  "erase",
  "confirmation dialog",
  "confirm dialog",
  "payment",
  "checkout",
  "banking",
  "bank account",
  "wallet",
  "private message",
  "direct message",
  "inbox",
  "email",
  "secret",
  "token",
  "api key",
  ".env",
];

export interface DesktopStepRequest {
  kind: DesktopActionKind;
  targetDescription: string;
  inputSummary?: string;
}

export interface DesktopPlanRequest {
  missionId: string;
  taskId: string;
  taskDescription: string;
  steps: DesktopStepRequest[];
}

export class DesktopActionPlanner {
  constructor(
    private readonly safetyGuard: SafetyGuard,
    private readonly receiptLog: ReceiptLog
  ) {}

  buildPlan(request: DesktopPlanRequest): DesktopPlanResult {
    if (request.steps.length === 0) {
      return this.refuse(request, "empty-plan", "no steps were provided");
    }

    // Gate 1: protected surfaces, checked per step and on the task text.
    const allTexts = [
      request.taskDescription,
      ...request.steps.flatMap((s) => [s.targetDescription, s.inputSummary ?? ""]),
    ];
    const flaggedIndex = allTexts.findIndex((text) => {
      const lowered = text.toLowerCase();
      return PROTECTED_SURFACE_INDICATORS.some((indicator) => lowered.includes(indicator));
    });
    if (flaggedIndex >= 0) {
      return this.refuse(request, "protected-surface", "a step targets a protected surface", {
        flaggedTextIndex: flaggedIndex,
      });
    }

    // Gate 2: SafetyGuard over everything a human would read in the plan.
    const decision = this.safetyGuard.evaluateText(allTexts.join("\n"));
    if (!decision.allowed) {
      return this.refuse(request, "safety-blocked", `blocked by SafetyGuard (${decision.level})`);
    }

    const planId = `desktop-plan-${randomUUID()}`;

    const actions: DesktopActionStep[] = request.steps.map((step) => ({
      stepId: `desktop-step-${randomUUID()}`,
      kind: step.kind,
      targetDescription: step.targetDescription,
      inputSummary: step.inputSummary,
      safetyClass: "safe-simulated",
      simulated: true,
      executed: false,
    }));

    const receipt = this.receiptLog.create({
      summary: "Desktop action plan created as simulated data (nothing performed).",
      status: "completed",
      links: { missionId: request.missionId, taskId: request.taskId },
      details: {
        planId,
        stepCount: actions.length,
        kinds: actions.map((a) => a.kind),
        safetyLevel: decision.level,
      },
    });

    const plan: DesktopActionPlan = {
      planId,
      missionId: request.missionId,
      taskId: request.taskId,
      actions,
      safetyDecision: decision,
      receiptId: receipt.receiptId,
      simulated: true,
      executed: false,
      requiresHumanApproval: true,
      createdAt: new Date().toISOString(),
    };

    return { ok: true, plan, receipt };
  }

  private refuse(
    request: DesktopPlanRequest,
    reasonCode: string,
    reasonText: string,
    extraDetails: Record<string, unknown> = {}
  ): DesktopPlanResult {
    // Redacted: no raw task or step text; lengths and a fingerprint only.
    const joined = `${request.taskDescription}\n${request.steps
      .map((s) => `${s.kind}:${s.targetDescription}`)
      .join("\n")}`;

    const receipt = this.receiptLog.create({
      summary: `Desktop action plan refused: ${reasonText}.`,
      status: "refused",
      links: { missionId: request.missionId, taskId: request.taskId },
      details: {
        reasonCode,
        stepCount: request.steps.length,
        planTextLength: joined.length,
        planTextFingerprint: fingerprint(joined),
        ...extraDetails,
      },
    });

    return {
      ok: false,
      refusal: {
        refusalId: `desktop-refusal-${randomUUID()}`,
        reasonCode,
        receiptId: receipt.receiptId,
        refusedAt: new Date().toISOString(),
      },
      receipt,
    };
  }
}
