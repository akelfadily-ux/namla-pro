/**
 * liveObjectiveCliHelpers — small, testable helpers for the human live-objective
 * CLI (Build Law §26). Extracted so the pre-spawn-hang regression can exercise
 * the readline lifecycle and stage vocabulary WITHOUT importing the CLI's real
 * driver graph.
 *
 * The key anti-hang guarantee: `askOnce` opens a readline, reads ONE answer, and
 * CLOSES it immediately — so `process.stdin` is never held open across the
 * synchronous provider-execution phase (an open readline on Windows blocks the
 * synchronous provider spawn and reads as an indefinite pre-spawn hang).
 *
 * No fs, no child_process, no network of its own.
 */

import { createInterface } from "readline";
import { redactMeta } from "../cognitive/safeRedactor";

/** A minimal readline-like interface — allows injecting a fake in tests. */
export interface QuestionInterface {
  question(query: string, callback: (answer: string) => void): void;
  close(): void;
}

/**
 * Ask ONE question with a short-lived readline that is CLOSED the instant the
 * answer is read. The readline factory is injectable for tests.
 */
export function askOnce(q: string, makeInterface: () => QuestionInterface = () => createInterface({ input: process.stdin, output: process.stdout })): Promise<string> {
  return new Promise((res) => {
    const rl = makeInterface();
    rl.question(q, (a) => {
      rl.close(); // release stdin immediately — never held across provider execution
      res(a);
    });
  });
}

/** Redacted stage log — stage name + safe scalars only (never prompts/creds/output). */
export function logStage(stage: string, extra: Record<string, string | number | boolean> = {}): void {
  // Every string value is redacted before it reaches the terminal: stage metadata
  // routinely carries provider-derived failure text.
  console.log(JSON.stringify({ stage, ...redactMeta(extra) }));
}

/** The ordered pre-spawn stages the live CLI emits after the start phrase. */
export const LIVE_PRE_SPAWN_STAGES: readonly string[] = ["confirmation-accepted", "live-permit-created", "cohort-permits-created", "workspace-ready", "provider-request-ready", "provider-spawn-starting", "provider-spawn-completed"];

/** Bounded window for the pre-spawn preparation phase before it fails loudly. */
export const PRE_SPAWN_PREPARATION_TIMEOUT_MS = 15000;
