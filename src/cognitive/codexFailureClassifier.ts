import { truncateUtf8 } from "./safeWorkspacePath";

export type CodexStructuredFailureCategory = "quota-exceeded";

function isQuotaExhaustionMessage(message: string): boolean {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("hit your usage limit") ||
    normalized.includes("usage limit reached") ||
    normalized.includes("quota exceeded") ||
    normalized.includes("insufficient_quota") ||
    normalized.includes("purchase more credits")
  );
}

export function classifyCodexStructuredFailure(
  stdout: string,
  maxBytes: number
): CodexStructuredFailureCategory | null {
  const capped = truncateUtf8(stdout, maxBytes).text;
  const lines = capped.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (typeof parsed !== "object" || parsed === null) continue;

    const event = parsed as Record<string, unknown>;
    let message: string | undefined;

    if (event.type === "error" && typeof event.message === "string") {
      message = event.message;
    }

    if (
      event.type === "turn.failed" &&
      typeof event.error === "object" &&
      event.error !== null
    ) {
      const error = event.error as Record<string, unknown>;
      if (typeof error.message === "string") {
        message = error.message;
      }
    }

    if (
      event.type === "item.completed" &&
      typeof event.item === "object" &&
      event.item !== null
    ) {
      const item = event.item as Record<string, unknown>;

      if (item.type === "error" && typeof item.message === "string") {
        message = item.message;
      }
    }

    if (message !== undefined && isQuotaExhaustionMessage(message)) {
      return "quota-exceeded";
    }
  }

  return null;
}
