/**
 * windowsSystemTools — trusted resolution of the Windows OS tools the process
 * tree depends on (`tasklist`, `taskkill`, `wmic`).
 *
 * THE DEFECT THIS EXISTS TO CLOSE. `processTree` used to spawn these by BARE
 * NAME. With `shell: false` Node hands a bare name to `CreateProcessW`, whose
 * documented search order begins with the directory of the calling image and
 * the CURRENT DIRECTORY before it ever reaches a system directory. So a
 * `taskkill.exe` dropped into the working directory — or anywhere earlier on
 * `PATH` — is what gets executed, with our privileges, at exactly the moment we
 * are trying to kill something. Termination tooling is the worst possible thing
 * to resolve by search: the whole point of the module is to end processes, so
 * substituting the binary hands an attacker the kill decision.
 *
 * The rule here is the same one S-9 applied to provider executables: DISCOVERY
 * IS NOT TRUST. A name that resolves is not a tool that may run. Resolution is
 * therefore path-free — `PATH` is never consulted at any point — and a tool is
 * only trusted when every one of these is proven:
 *
 *   1. the root is the PINNED conventional Windows location, or one supplied as
 *      explicit trusted configuration. The environment is never an authority —
 *      see `resolveSystemRoot` for why `SystemRoot`/`WINDIR` are not read at
 *      all, and why a planted `kernel32.dll` proves nothing on its own;
 *   2. the tool sits at its exact expected location under that root — and for
 *      `wmic` that is System32\wbem, never System32 itself;
 *   3. NO COMPONENT of the path is a reparse point. Root, System32, wbem and
 *      the file are each checked, because a junction on any of them redirects
 *      everything beneath it;
 *   4. the canonical form equals the LITERAL expected path. Canonicalising the
 *      parent and then asking whether the child lies inside it is circular, and
 *      is exactly how a junctioned System32 used to validate itself;
 *   5. the extension is `.exe` — never `.cmd` or `.bat`, which are mutable
 *      scripts and which Node ≥18.20.2 refuses under `shell: false` anyway.
 *
 * WHEN THE TOOL CANNOT BE PROVEN, THIS FAILS CLOSED. It returns a refusal and a
 * reason code. It never falls back to a bare name, never widens the search, and
 * never substitutes a different tool. `wmic` in particular is ABSENT by default
 * on current Windows (removed from Windows 11 24H2 onward), so "not found" is
 * the normal, expected answer there and callers must treat it as "this evidence
 * is unavailable" rather than as "there is nothing to report".
 *
 * ENVIRONMENT. These tools are given the smallest environment that still works,
 * not the caller's. The binary is already absolute so `PATH` cannot pick it —
 * but the Windows DLL search order DOES read `PATH`, so an inherited one lets a
 * planted DLL ride along into a trusted executable. `PATH` is therefore rebuilt
 * from the proven system directories only.
 */

import { existsSync, lstatSync, realpathSync, statSync } from "fs";
import { delimiter, isAbsolute, join, parse, sep } from "path";

export type WindowsSystemToolId = "tasklist" | "taskkill" | "wmic";

export type WindowsSystemToolReasonCode =
  | "ok"
  | "not-windows"
  | "system-root-unresolvable"
  | "system-root-not-a-windows-install"
  | "tool-not-found"
  | "tool-not-a-regular-file"
  | "tool-outside-system-directory"
  | "tool-extension-refused";

export interface ResolvedWindowsSystemTool {
  readonly id: WindowsSystemToolId;
  /** Canonical absolute path to the `.exe`. This is what may be spawned. */
  readonly command: string;
  /** Proven Windows installation root, e.g. `C:\WINDOWS`. */
  readonly systemRoot: string;
  /** Proven `System32` directory. */
  readonly systemDirectory: string;
  /** The minimal environment this tool must be spawned with. */
  readonly environment: Readonly<Record<string, string>>;
}

export type WindowsSystemToolResult =
  | { readonly ok: true; readonly value: ResolvedWindowsSystemTool; readonly reasonCode: "ok" }
  | { readonly ok: false; readonly value: null; readonly reasonCode: WindowsSystemToolReasonCode };

export interface WindowsSystemToolOptions {
  /** Platform seam, so the rule itself is testable on any host. */
  readonly platform?: NodeJS.Platform;
  /**
   * TEST SEAM ONLY — NOT a production configuration channel.
   *
   * Named to make the trust boundary unmistakable. Production has exactly one
   * call site (`NodeProcessTreeDriver.runTool`) and it passes NO options at
   * all, so this can only ever be populated by a test that hard-codes its own
   * planted fixture directory. No workspace path, provider response, request
   * payload, environment variable or PATH entry can reach it: there is no code
   * path from any of those to this field.
   *
   * It exists so the resolution rules — reparse refusal, containment,
   * extension, missing-tool — are provable on Linux and macOS too. Everything a
   * kernel-supplied root must satisfy, a test-supplied one must satisfy
   * identically; the seam grants no exemptions.
   */
  readonly testOnlySystemRoot?: string;
  /**
   * ACCEPTED AND DELIBERATELY IGNORED.
   *
   * Retained purely so a test can hand this function a thoroughly poisoned
   * environment — `SystemRoot`, `WINDIR`, `PATH`, all pointing at attacker
   * territory — and demonstrate that it changes nothing, because no code path
   * reads it. Removing the field would make that proof impossible to express.
   */
  readonly environment?: NodeJS.ProcessEnv;
}

/**
 * Where each tool genuinely lives, relative to System32.
 *
 * `wmic` is NOT in System32. It is `System32\wbem\WMIC.exe`, and looking for it
 * beside `tasklist` would report "absent" on a machine that actually has it.
 */
const TOOL_SUBDIRECTORY: Readonly<Record<WindowsSystemToolId, string>> = {
  tasklist: "",
  taskkill: "",
  wmic: "wbem",
};

/**
 * THE AUTHORITY: the kernel's own name for the running Windows installation.
 *
 * `\SystemRoot` is a symbolic link in the NT object manager namespace, created
 * by the kernel during boot from the actual boot volume and installation
 * directory. `\\?\GLOBALROOT\…` is the Win32 door into that namespace, so
 * resolving this path asks WINDOWS where Windows is.
 *
 * That is categorically different from every channel previously used here:
 *
 *   process.env.SystemRoot   an inherited string; anyone who can set our
 *                            environment can set it
 *   PATH / cwd               attacker-influenced by design
 *   "C:\Windows"             a guess. Correct on most machines and WRONG on an
 *                            installation rooted elsewhere — and on such a
 *                            machine an ordinary `C:\Windows` directory that
 *                            anyone could create would have been trusted
 *   kernel32.dll present     corroboration; whoever plants the tools can plant
 *                            this too
 *
 * None of those can be forged only by a process that already owns the kernel,
 * which is the property a root authority needs. This one can't be set from
 * user space at all.
 *
 * MEASURED ON A REAL HOST before being relied on:
 *   realpathSync.native(...)                 -> C:\Windows      (the real root)
 *   ...\System32, \System32\wbem, kernel32.dll, tasklist.exe   all present
 *   readdir(...\System32)                    -> 4631 entries
 *   spawn(...\System32\tasklist.exe)         -> EINVAL
 *
 * That last line is why this is a DISCOVERY authority, not an execution path:
 * `CreateProcess` rejects a GLOBALROOT-prefixed image. The link is resolved to
 * its canonical DOS path, and that canonical path is what is validated and
 * spawned.
 */
const OBJECT_MANAGER_SYSTEM_ROOT = "\\\\?\\GLOBALROOT\\SystemRoot";

/**
 * Ask the kernel where Windows is. Returns a canonical DOS path, or null.
 *
 * On an installation rooted at `D:\Windows` this returns `D:\Windows` — the
 * ACTUAL root — where the previous implementation would have accepted any
 * `C:\Windows` directory that happened to exist.
 */
export function authoritativeSystemRoot(): string | null {
  try {
    const real = realpathSync.native(OBJECT_MANAGER_SYSTEM_ROOT);
    if (typeof real !== "string" || real.length === 0 || !isAbsolute(real)) return null;
    // The object-manager path itself must never escape into a spawn argument.
    if (real.startsWith("\\\\?\\GLOBALROOT")) return null;
    return real;
  } catch {
    return null;
  }
}

/** Windows paths are case-insensitive; comparisons here must be too. */
function sameWindowsPath(a: string, b: string): boolean {
  return a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();
}

/**
 * `realpath` via the OS resolver where available.
 *
 * The native variant asks Windows itself, which resolves reparse points the way
 * the loader will. Returns the input unchanged on failure so the caller's
 * equality check fails closed rather than throwing.
 */
function realpathNative(p: string): string {
  try {
    return realpathSync.native ? realpathSync.native(p) : realpathSync(p);
  } catch {
    return "";
  }
}

function fileExists(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Is this path itself a reparse point (symlink OR directory junction)?
 *
 * `lstat` describes the ENTRY, so a junction is visible here rather than being
 * silently traversed. An unreadable path answers `true`: if we cannot see what
 * something is, we must not treat it as safe.
 *
 * This is checked on EVERY component, not just the executable. A junction at
 * `System32` redirects everything beneath it, and a check that only inspects
 * the final file never notices.
 */
function isReparsePoint(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return true;
  }
}

/** Establish the Windows system directory, or refuse. */
function resolveSystemRoot(opts: WindowsSystemToolOptions): { readonly root: string; readonly systemDirectory: string } | { readonly failure: WindowsSystemToolReasonCode } {
  // THE KERNEL IS THE AUTHORITY. Not the environment, not PATH, not the cwd,
  // not a hard-coded drive letter, and not a candidate directory vouching for
  // itself by containing the filenames we expect.
  //
  // Successive reviews removed each weaker anchor in turn. The last one to go
  // was the pinned `C:\Windows` literal: correct on most machines, but a GUESS,
  // and on an installation rooted elsewhere it would have trusted whatever
  // ordinary `C:\Windows` directory happened to exist. A pinned string is not
  // an OS authority. `\\?\GLOBALROOT\SystemRoot` is — see above.
  //
  // There is NO fallback. If the kernel cannot be asked, this refuses; it does
  // not quietly drop back to `C:\Windows`, `SystemRoot`, `WINDIR` or `PATH`.
  const candidate = opts.testOnlySystemRoot ?? authoritativeSystemRoot();

  if (typeof candidate !== "string" || candidate.length === 0) return { failure: "system-root-unresolvable" };
  if (!isAbsolute(candidate)) return { failure: "system-root-unresolvable" }; // a relative root is a current-directory trap

  const systemDirectory = join(candidate, "System32");

  // Every component, in order, must be a real directory that is NOT a reparse
  // point. Checking only the leaf is what let a junction at `System32` redirect
  // the whole subtree.
  for (const component of [candidate, systemDirectory]) {
    if (isReparsePoint(component)) return { failure: "system-root-not-a-windows-install" };
    try {
      if (!lstatSync(component).isDirectory()) return { failure: "system-root-not-a-windows-install" };
    } catch {
      return { failure: "system-root-unresolvable" };
    }
  }

  // Corroboration, NOT authority: a real system directory has kernel32.dll. It
  // cannot prove ownership by the OS — the point of pinning the path above is
  // that this check never has to carry that weight.
  if (!fileExists(join(systemDirectory, "kernel32.dll"))) return { failure: "system-root-not-a-windows-install" };

  // The literal path must be its own canonical form. Compared against the
  // EXPECTED LITERAL, never against a canonicalised parent — canonicalising the
  // parent and then asking whether the child is inside it is circular, and is
  // precisely how a junction previously validated itself.
  if (!sameWindowsPath(realpathNative(systemDirectory), systemDirectory)) return { failure: "system-root-not-a-windows-install" };

  return { root: candidate, systemDirectory };
}

/**
 * The smallest environment these tools actually need.
 *
 * Reasoning per variable, because deleting blindly breaks Windows just as
 * surely as inheriting blindly weakens it:
 *
 *   SystemRoot / windir  REQUIRED. Windows components resolve their own
 *                        resources through it; omitting it breaks the tools.
 *   SystemDrive          Cheap, expected by some system tooling, derived from
 *                        the proven root rather than from the caller.
 *   PATH                 REBUILT, never inherited. It cannot select our binary
 *                        (absolute path, `shell: false`), but the DLL search
 *                        order reads it, so an inherited PATH is a dependency
 *                        injection channel into a trusted executable. Only the
 *                        proven system directories appear.
 *   PATHEXT              Pinned to `.EXE` so no `.CMD`/`.BAT` interpretation
 *                        can arise anywhere downstream.
 *
 * Deliberately ABSENT:
 *
 *   COMSPEC              No shell is ever invoked (`shell: false`, direct
 *                        `.exe`), so nothing reads it — and a poisoned COMSPEC
 *                        therefore has nothing to poison.
 *   TEMP / TMP           None of these three tools needs a scratch directory
 *                        for the fixed, read-only queries issued here. Passing
 *                        the caller's would hand an attacker-chosen directory
 *                        to a privileged tool for no benefit.
 *   everything else      Not required, so not supplied.
 */
export function windowsSystemToolEnvironment(systemRoot: string, systemDirectory: string): Readonly<Record<string, string>> {
  const drive = parse(systemRoot).root.replace(new RegExp(`\\${sep}+$`), "");
  const env: Record<string, string> = {
    SystemRoot: systemRoot,
    windir: systemRoot,
    PATH: [systemDirectory, systemRoot, join(systemDirectory, "wbem")].join(delimiter),
    PATHEXT: ".EXE",
  };
  if (drive.length > 0) env.SystemDrive = drive;
  return Object.freeze(env);
}

/**
 * Resolve one Windows system tool, or refuse with a reason.
 *
 * PATH IS NEVER CONSULTED — not as a fallback, not as a hint. The only inputs
 * are the proven system root and the tool's fixed expected location.
 */
export function resolveWindowsSystemTool(id: WindowsSystemToolId, opts: WindowsSystemToolOptions = {}): WindowsSystemToolResult {
  const platform = opts.platform ?? process.platform;
  if (platform !== "win32") return { ok: false, value: null, reasonCode: "not-windows" };

  const root = resolveSystemRoot(opts);
  if ("failure" in root) return { ok: false, value: null, reasonCode: root.failure };

  const subdirectory = TOOL_SUBDIRECTORY[id];
  const directory = subdirectory ? join(root.systemDirectory, subdirectory) : root.systemDirectory;

  // An intermediate directory (`System32\wbem`) gets the same treatment as the
  // ones above it: real directory, not a reparse point. Otherwise a junction at
  // `wbem` would relocate `wmic` while `System32` itself looked pristine.
  if (subdirectory) {
    if (isReparsePoint(directory)) return { ok: false, value: null, reasonCode: "tool-outside-system-directory" };
    try {
      if (!lstatSync(directory).isDirectory()) return { ok: false, value: null, reasonCode: "tool-outside-system-directory" };
    } catch {
      return { ok: false, value: null, reasonCode: "tool-not-found" };
    }
    if (!sameWindowsPath(realpathNative(directory), directory)) return { ok: false, value: null, reasonCode: "tool-outside-system-directory" };
  }

  const candidate = join(directory, `${id}.exe`);

  if (!existsSync(candidate)) return { ok: false, value: null, reasonCode: "tool-not-found" };

  // A symlink or junction standing in for the tool is refused, NOT followed.
  if (isReparsePoint(candidate)) return { ok: false, value: null, reasonCode: "tool-not-a-regular-file" };
  let link;
  try {
    link = lstatSync(candidate);
  } catch {
    return { ok: false, value: null, reasonCode: "tool-not-found" };
  }
  if (!link.isFile()) return { ok: false, value: null, reasonCode: "tool-not-a-regular-file" };

  // The canonical form must equal the LITERAL expected path. This is the
  // non-circular version of the old containment test: nothing is canonicalised
  // and then used as its own yardstick, so no redirection can validate itself.
  if (!sameWindowsPath(realpathNative(candidate), candidate)) return { ok: false, value: null, reasonCode: "tool-outside-system-directory" };

  // Never a mutable script, whatever the directory listing claims.
  if (/\.(cmd|bat)$/i.test(candidate) || !/\.exe$/i.test(candidate)) return { ok: false, value: null, reasonCode: "tool-extension-refused" };

  const canonical = candidate;

  return {
    ok: true,
    reasonCode: "ok",
    value: { id, command: canonical, systemRoot: root.root, systemDirectory: root.systemDirectory, environment: windowsSystemToolEnvironment(root.root, root.systemDirectory) },
  };
}
