/**
 * missionObjectiveFile — the bounded seam that lets a real mission be supplied to
 * a live run from a file instead of being compiled into a CLI (TWIN-R1).
 *
 * WHY THIS IS A SECURITY BOUNDARY AND NOT A CONVENIENCE. The text this module
 * returns is placed into a provider prompt. That makes it two things at once: an
 * instruction the provider will act on, and a potential exfiltration channel for
 * whatever file it names. So the path is constrained (must resolve INSIDE an
 * approved root, must be an ordinary file, must carry an approved extension) and
 * the text is constrained (bounded UTF-8, non-empty, no control characters).
 *
 * WHAT THE OBJECTIVE CAN NEVER DO. It is DATA. It never becomes an argv entry,
 * never becomes a command, and never reaches a shell: the provider argv template
 * is fixed in `safeProviderRequest.ts` and the objective travels only inside the
 * bounded prompt, which that module also screens for credentials and fails closed
 * on. Nothing here can widen provider authority.
 *
 * The path logic and the text validation are pure and exported separately so the
 * refusal rules can be tested without touching a filesystem.
 */

import { lstatSync, readFileSync, realpathSync } from "fs";
import { extname, isAbsolute, resolve } from "path";
import { pathIsInside, utf8Bytes } from "./safeWorkspacePath";

/** Objective text may never exceed the smallest provider input budget. */
export const MAX_OBJECTIVE_BYTES = 8000 as const;

/** Only ordinary text documents. A path with any other extension is refused. */
export const ALLOWED_OBJECTIVE_EXTENSIONS: readonly string[] = [".md", ".txt"];

export type MissionObjectiveReason =
  | "ok"
  | "empty-path"
  | "path-escapes-approved-root"
  | "unapproved-extension"
  | "not-a-regular-file"
  | "unreadable"
  | "empty-objective"
  | "objective-too-large"
  | "control-characters"
  | "invalid-mission-id";

export type MissionObjectiveResult =
  | { readonly ok: true; readonly objective: string; readonly bytes: number; readonly absolutePath: string }
  | { readonly ok: false; readonly reasonCode: MissionObjectiveReason };

/**
 * Mission ids name workspace directories, so the shape is deliberately narrower
 * than a path check: lowercase alphanumerics and single hyphens only. A value
 * that cannot contain a separator, a dot, or a drive letter cannot traverse.
 */
export function validateMissionId(missionId: string): boolean {
  return typeof missionId === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(missionId) && !missionId.includes("--");
}

/**
 * Resolve and constrain the objective path. Pure: no filesystem access, so the
 * containment rule can be proven directly.
 *
 * The resolved target must be INSIDE an approved root and must not BE one — a
 * root itself is a directory, and accepting it would make the containment check
 * describe nothing.
 */
export function resolveMissionObjectivePath(rawPath: string, approvedRoots: readonly string[]): { readonly ok: boolean; readonly reasonCode: MissionObjectiveReason; readonly absolutePath?: string } {
  if (typeof rawPath !== "string" || rawPath.trim().length === 0) return { ok: false, reasonCode: "empty-path" };
  const roots = approvedRoots.filter((r) => typeof r === "string" && r.length > 0 && isAbsolute(r));
  if (roots.length === 0) return { ok: false, reasonCode: "path-escapes-approved-root" };
  const absolutePath = isAbsolute(rawPath) ? resolve(rawPath) : resolve(roots[0], rawPath);
  const contained = roots.some((root) => pathIsInside(root, absolutePath) && resolve(root) !== absolutePath);
  if (!contained) return { ok: false, reasonCode: "path-escapes-approved-root" };
  if (!ALLOWED_OBJECTIVE_EXTENSIONS.includes(extname(absolutePath).toLowerCase())) return { ok: false, reasonCode: "unapproved-extension" };
  return { ok: true, reasonCode: "ok", absolutePath };
}

/**
 * Constrain the objective TEXT. Pure.
 *
 * Control characters are refused rather than stripped: a NUL can truncate a
 * value at an OS boundary, and an escape sequence in text that will be echoed
 * into a terminal report is a display-integrity problem. Refusing states the
 * position; stripping would silently change what the operator asked for.
 */
export function validateMissionObjectiveText(text: string, maxBytes: number = MAX_OBJECTIVE_BYTES): { readonly ok: boolean; readonly reasonCode: MissionObjectiveReason; readonly objective?: string; readonly bytes?: number } {
  if (typeof text !== "string") return { ok: false, reasonCode: "empty-objective" };
  const objective = text.trim();
  if (objective.length === 0) return { ok: false, reasonCode: "empty-objective" };
  // Explicit escapes: C0 controls plus DEL. Tab, newline and carriage return are
  // permitted because a mission document legitimately contains them.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(objective)) return { ok: false, reasonCode: "control-characters" };
  const bytes = utf8Bytes(objective);
  // Refused, never truncated: half a mission is a different mission, and silently
  // shortening it would send the provider an instruction nobody wrote.
  if (bytes > maxBytes) return { ok: false, reasonCode: "objective-too-large" };
  return { ok: true, reasonCode: "ok", objective, bytes };
}

/**
 * Load one objective file. The only function here that touches a filesystem.
 *
 * TWO containment checks, because one is not enough on Windows.
 *
 * `resolveMissionObjectivePath` is LEXICAL: it normalises `..` and compares
 * strings. That catches traversal but not a junction or symlink sitting in an
 * INTERMEDIATE directory - `workspaces/link/mission.md` is lexically inside
 * `workspaces/` no matter where `link` actually points. So the real path is
 * resolved here and containment is re-checked against the resolved roots, and
 * `lstatSync` (not `statSync`) additionally refuses a link as the final
 * component rather than following it.
 *
 * WHAT THIS DOES NOT PROVE: the check is time-of-check/time-of-use, so a path
 * replaced between the check and the read is not detected. Comparison uses
 * Node's own `relative`, which is case-insensitive on win32 for the drive root;
 * no claim is made about exotic 8.3 aliases or UNC edge cases beyond what
 * `realpathSync` itself normalises.
 */
export function loadMissionObjectiveFile(rawPath: string, approvedRoots: readonly string[], maxBytes: number = MAX_OBJECTIVE_BYTES): MissionObjectiveResult {
  const resolved = resolveMissionObjectivePath(rawPath, approvedRoots);
  if (!resolved.ok || !resolved.absolutePath) return { ok: false, reasonCode: resolved.reasonCode };
  let raw: string;
  try {
    const stat = lstatSync(resolved.absolutePath);
    // A link as the FINAL component is refused, never followed.
    if (!stat.isFile()) return { ok: false, reasonCode: "not-a-regular-file" };
    if (stat.size > maxBytes * 4) return { ok: false, reasonCode: "objective-too-large" };
    // SECOND containment check, on the RESOLVED path: defeats a junction or
    // symlink in any intermediate directory, which the lexical check cannot see.
    const realTarget = realpathSync(resolved.absolutePath);
    const realRoots = approvedRoots.filter((r) => typeof r === "string" && r.length > 0 && isAbsolute(r)).map((r) => {
      try {
        return realpathSync(r);
      } catch {
        return r;
      }
    });
    if (!realRoots.some((root) => pathIsInside(root, realTarget) && root !== realTarget)) {
      return { ok: false, reasonCode: "path-escapes-approved-root" };
    }
    raw = readFileSync(realTarget, "utf8");
  } catch {
    return { ok: false, reasonCode: "unreadable" };
  }
  const validated = validateMissionObjectiveText(raw, maxBytes);
  if (!validated.ok || validated.objective === undefined || validated.bytes === undefined) return { ok: false, reasonCode: validated.reasonCode };
  return { ok: true, objective: validated.objective, bytes: validated.bytes, absolutePath: resolved.absolutePath };
}
