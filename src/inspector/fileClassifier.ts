/**
 * fileClassifier holds the inspector's skip and classification rules in one
 * place: which folders are never entered, which filenames look secret-like,
 * and which extensions count as safe small text files.
 *
 * There are two secret gates with different strictness:
 *
 * - isSecretLikeFilenameForWalk (tree listing): project source files
 *   (.ts/.js) whose names merely mention secret concepts — like this
 *   project's own secretProtectionPolicy.ts — ARE listed, because hiding
 *   them would give the colony an incomplete snapshot of its own safety
 *   layer. Real secret stores (.env, key material, ssh keys) are still
 *   never listed, sized, or opened.
 *
 * - isSecretLikeFilename (content reading): the strict gate. Any filename
 *   mentioning a secret concept is refused for reads, source code included.
 *   A false positive here (refusing to read a harmless policy file) is
 *   acceptable; a false negative is not.
 */

import { looksLikeSecret } from "../policies/secretProtectionPolicy";

export const IGNORED_FOLDER_NAMES: string[] = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".cache",
  ".next",
  ".turbo",
  ".claude",
  "tmp",
  "temp",
];

const SECRET_FILENAME_INDICATORS: string[] = [
  ".env",
  "secret",
  "token",
  "credential",
  "password",
  "apikey",
  "api-key",
  "api_key",
  "private-key",
  "private_key",
  "privatekey",
  "id_rsa",
  "auth.",
];

const SECRET_FILE_EXTENSIONS: string[] = [
  ".pem",
  ".key",
  ".pfx",
  ".p12",
  ".crt",
  ".der",
  ".keystore",
  ".jks",
];

const TEXT_FILE_EXTENSIONS: string[] = [
  ".md",
  ".ts",
  ".js",
  ".json",
  ".txt",
  ".yml",
  ".yaml",
  ".html",
  ".css",
];

/** Extensions of project source files that snapshots must not hide. */
const SOURCE_CODE_EXTENSIONS: string[] = [".ts", ".js"];

export function isIgnoredFolder(folderName: string): boolean {
  return IGNORED_FOLDER_NAMES.includes(folderName.toLowerCase());
}

/**
 * Names that are secret stores regardless of anything else: dotenv files,
 * ssh keys, and key-material extensions. Blocked by both gates, always.
 */
function isAlwaysSecretName(loweredFileName: string): boolean {
  if (loweredFileName.includes(".env")) return true;
  if (loweredFileName.includes("id_rsa")) return true;
  return SECRET_FILE_EXTENSIONS.some((ext) => loweredFileName.endsWith(ext));
}

/** Strict gate: used by readSmallTextFile before any content is opened. */
export function isSecretLikeFilename(fileName: string): boolean {
  const lowered = fileName.toLowerCase();
  if (isAlwaysSecretName(lowered)) return true;
  if (SECRET_FILENAME_INDICATORS.some((indicator) => lowered.includes(indicator))) return true;
  return looksLikeSecret(lowered);
}

/**
 * Walk gate: used when listing the tree. Source code that merely mentions a
 * secret concept in its name is listed (never hidden from snapshots), but
 * still refused for content reads by the strict gate above.
 */
export function isSecretLikeFilenameForWalk(fileName: string): boolean {
  const lowered = fileName.toLowerCase();
  if (isAlwaysSecretName(lowered)) return true;
  if (SOURCE_CODE_EXTENSIONS.some((ext) => lowered.endsWith(ext))) return false;
  return isSecretLikeFilename(fileName);
}

export function isTextFileExtension(extension: string): boolean {
  return TEXT_FILE_EXTENSIONS.includes(extension.toLowerCase());
}

export function extensionOf(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0) return ""; // no extension, or dotfile like ".gitignore"
  return fileName.slice(dotIndex).toLowerCase();
}
