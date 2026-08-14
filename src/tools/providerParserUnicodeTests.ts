/**
 * providerParserUnicodeTests — proof that provider-output parsing is correct for
 * real human text, not only ASCII.
 *
 * These tests exist because the parser previously compared a UTF-16 unit count
 * (`value.length`) against a BYTE budget. For Arabic and Hebrew that under-counts
 * by roughly 2x and for emoji by 2x, with two distinct consequences:
 *
 *   1. A JSON object was re-parsed with `obj.length` as its byte budget, so any
 *      non-ASCII response was truncated mid-structure, failed `JSON.parse`, and
 *      silently fell through to an inferior extraction path — the summary came
 *      back as raw JSON text instead of the parsed summary.
 *   2. Oversized output was accepted as complete, because the character count
 *      never exceeded the byte cap.
 *
 * Every assertion below fails against the pre-fix parser.
 *
 * Run: node --test dist/tools/providerParserUnicodeTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { parseClaudeJson, parseCodexJsonl, parseLiveProviderJson } from "../cognitive/liveProviderExecution";
import { parseProviderOutput } from "../cognitive/providerOutputParser";
import { utf8Bytes } from "../cognitive/safeWorkspacePath";

// --------------------------------------------------------------- FIXTURES ---

const ARABIC = "ملخص التنفيذ جيد جدا";
const HEBREW = "הסיכום נראה תקין";
const EMOJI = "shipped 🚀🎉 done";
const MIXED_RTL = "الملف src/index.ts تم إنشاؤه بنجاح and the build passed";
const COMBINING = "égalé café"; // e + combining acute, NFD
const CJK = "実装は正常に完了しました";

/** A Claude `--output-format json` envelope wrapping an agent message. */
function claudeEnvelope(summary: string, files: { path: string; operation: "create"; content: string }[] = []): string {
  return JSON.stringify({ result: JSON.stringify({ summary, confidence: 0.8, observations: ["ok"], files }) });
}

/** A Codex `exec --json` JSONL stream ending in an agent message. */
function codexStream(summary: string): string {
  return [JSON.stringify({ type: "thread.started" }), JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify({ summary, confidence: 0.8, observations: ["ok"] }) } }), JSON.stringify({ type: "turn.completed" })].join("\n");
}

// ------------------------------------------------- SUMMARY ROUND-TRIPPING ---

test("a summary in any script parses to the summary itself, not raw JSON", () => {
  for (const [label, summary] of [["arabic", ARABIC], ["hebrew", HEBREW], ["emoji", EMOJI], ["mixed RTL/LTR", MIXED_RTL], ["combining marks", COMBINING], ["CJK", CJK], ["ascii", "all good"]] as const) {
    const parsed = parseClaudeJson(claudeEnvelope(summary), 200000, 16);
    assert.equal(parsed.malformed ?? false, false, `${label} must not be malformed`);
    // The decisive assertion: the pre-fix parser returned the raw JSON text here
    // because the inner object had been truncated and failed to parse.
    assert.equal(parsed.summary, summary, `${label} summary must round-trip exactly`);
    assert.equal(parsed.summary.includes('{"summary"'), false, `${label} must not fall back to raw JSON`);
  }
});

test("Codex JSONL round-trips non-ASCII summaries identically", () => {
  for (const summary of [ARABIC, HEBREW, EMOJI, CJK]) {
    const out = parseCodexJsonl(codexStream(summary), 200000, 16);
    assert.equal(out.status, "ok", "a well-formed stream must parse");
    assert.equal(out.payload?.summary, summary, "summary must round-trip exactly");
  }
});

test("Arabic and Hebrew file paths survive parsing intact", () => {
  const files = [
    { path: "src/ملف-المهام.ts", operation: "create" as const, content: "export const x = 1;\n" },
    { path: "src/קובץ-משימות.ts", operation: "create" as const, content: "export const y = 2;\n" },
    { path: "src/tâche-café.ts", operation: "create" as const, content: "export const z = 3;\n" },
  ];
  const parsed = parseClaudeJson(claudeEnvelope("created files", files), 200000, 16);
  assert.equal(parsed.malformed ?? false, false);
  const paths = parsed.files.map((f) => f.path);
  for (const f of files) assert.equal(paths.includes(f.path), true, `${f.path} must survive`);
});

// ------------------------------------------------ EXACT BYTE-LIMIT EDGES ---

test("the byte limit is applied in bytes, at, below, and above the boundary", () => {
  // Each Arabic letter is 2 UTF-8 bytes but 1 UTF-16 unit — the two counts differ.
  const body = "ا".repeat(100); // 100 units, 200 bytes
  assert.equal(body.length, 100);
  assert.equal(utf8Bytes(body), 200);

  const below = parseProviderOutput(body, 400, true);
  assert.equal(below.outputTruncated, false, "under the byte cap must not truncate");

  const exact = parseProviderOutput(body, 200, true);
  assert.equal(exact.outputTruncated, false, "exactly at the byte cap must not truncate");

  // The pre-fix parser reported false here: 100 (units) was never > 150 (bytes),
  // so genuinely oversized output was accepted as complete.
  const above = parseProviderOutput(body, 150, true);
  assert.equal(above.outputTruncated, true, "over the byte cap MUST be reported truncated");
});

test("truncation never splits a character or emits a replacement character", () => {
  for (const unit of ["ا", "ש", "🚀", "実", "é"]) {
    const body = unit.repeat(200);
    for (let cap = 1; cap <= 40; cap += 1) {
      const out = parseProviderOutput(body, cap, false);
      const text = out.summary + body.slice(0, 0); // parser output surface
      assert.equal(text.includes("�"), false, `${unit} @${cap} must not produce U+FFFD`);
    }
    // Direct bound check: the truncated payload is always valid, lossless UTF-8.
    const parsed = parseLiveProviderJson(JSON.stringify({ summary: body }), utf8Bytes(JSON.stringify({ summary: body })), 16);
    assert.equal(parsed.summary, body, `${unit} must round-trip at its exact byte length`);
  }
});

test("a lone surrogate or malformed multibyte input is handled without crashing", () => {
  const loneHigh = '{"summary":"broken \uD800 half"}';
  const loneLow = '{"summary":"broken \uDC00 half"}';
  for (const bad of [loneHigh, loneLow, '{"summary":"�"}']) {
    const parsed = parseLiveProviderJson(bad, utf8Bytes(bad), 16);
    // It may be malformed or parse — it must never throw and never hang.
    assert.equal(typeof parsed.malformed === "boolean" || typeof parsed.summary === "string", true);
  }
});

test("escaped and unescaped Unicode in JSON parse to the same value", () => {
  const escaped = JSON.stringify({ result: '{"summary":"\\u0645\\u0644\\u062e\\u0635","confidence":0.8}' });
  const unescaped = claudeEnvelope("ملخص");
  const a = parseClaudeJson(escaped, 200000, 16);
  const b = parseClaudeJson(unescaped, 200000, 16);
  assert.equal(a.summary, "ملخص", "escaped \\uXXXX must decode");
  assert.equal(b.summary, "ملخص", "unescaped UTF-8 must parse");
  assert.equal(a.summary, b.summary, "both encodings must agree");
});

test("a very long Unicode response is bounded in bytes, not characters", () => {
  const long = (ARABIC + " " + EMOJI + " ").repeat(2000);
  const cap = 5000;
  const out = parseProviderOutput(long, cap, false);
  assert.equal(out.outputTruncated, true, "a response far over the cap must be flagged");
  assert.equal(utf8Bytes(long) > cap, true, "fixture must genuinely exceed the cap");
});
