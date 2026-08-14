/**
 * Phase 8 desktop-action types. A DesktopActionPlan describes what a bot
 * body WOULD do on a desktop — as data. Nothing in these types can hold a
 * real coordinate, window handle, screenshot, OS handle, or credential:
 * targets are human-language descriptions, inputs are summaries, and the
 * simulated/executed/approval fields are literal types, so a performed
 * desktop action is unrepresentable.
 */

import type { SafetyDecision } from "../types/safetyTypes";
import type { ActionReceipt } from "../types/receiptTypes";

export type DesktopActionKind =
  | "click"
  | "type-text"
  | "open-app"
  | "focus-window"
  | "read-screen-region";

export type DesktopSafetyClass = "safe-simulated" | "protected-surface" | "refused";

export interface DesktopActionStep {
  stepId: string;
  kind: DesktopActionKind;
  /** Human-language description of the target; never a coordinate or handle. */
  targetDescription: string;
  /** Summary of what WOULD be typed (type-text only); never credentials. */
  inputSummary?: string;
  safetyClass: DesktopSafetyClass;
  simulated: true;
  executed: false;
}

export interface DesktopActionPlan {
  planId: string;
  missionId: string;
  taskId: string;
  actions: DesktopActionStep[];
  /** The SafetyGuard decision that allowed this plan to exist. */
  safetyDecision: SafetyDecision;
  receiptId: string;
  simulated: true;
  executed: false;
  requiresHumanApproval: true;
  createdAt: string;
}

export interface DesktopPlanRefusal {
  refusalId: string;
  /** Machine-readable reason, e.g. "protected-surface", "safety-blocked". */
  reasonCode: string;
  receiptId: string;
  refusedAt: string;
}

export type DesktopPlanResult =
  | { ok: true; plan: DesktopActionPlan; receipt: ActionReceipt }
  | { ok: false; refusal: DesktopPlanRefusal; receipt: ActionReceipt };

/** One line of simulated narration; the literals travel with every line. */
export interface DesktopNarrationLine {
  stepId: string;
  kind: DesktopActionKind;
  text: string;
  simulated: true;
  executed: false;
}
