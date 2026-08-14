/**
 * ReceiptLog records every attempted action in the colony, approved or
 * blocked, in memory. Phase 0 has no persistence layer — receipts live for
 * the lifetime of the process. ReceiptLog never accepts secret-shaped
 * content into a receipt's details.
 */

import type { ActionReceipt, ReceiptLink, ReceiptStatus } from "../types/receiptTypes";
import { looksLikeSecret } from "../policies/secretProtectionPolicy";
import { containsSecretValue } from "../cognitive/safeRedactor";

/**
 * Scan `details` for an actual secret VALUE (§37).
 *
 * Before S-7 `create()` validated `params.summary` and stored `details`
 * untouched, so a live credential placed in a diagnostic field entered receipts
 * and every downstream consumer of colony state.
 *
 * Deliberately NOT `JSON.stringify(details)`: that invokes user-defined
 * `toJSON`, throws on cycles, and builds a raw-secret intermediate string —
 * the last thing a secret scanner should create. This walks the structure
 * instead.
 *
 * The accepted shape is enforced narrowly, and that narrowness is measured
 * rather than assumed: across all 41 demos, 379 `create()` calls produced only
 * strings, numbers, booleans, null, undefined, plain objects and arrays, with a
 * maximum depth of 4, zero cyclic references and zero accessor properties.
 * Anything outside that JSON-like shape fails closed rather than being scanned
 * incompletely.
 *
 * Value checking uses the canonical predicate, so it targets real credentials
 * rather than the English noun "token" — a receipt whose diagnostic mentions a
 * token by name stays useful.
 *
 * Returns a REASON only. Never the offending value, its key path, its length,
 * or a digest of it.
 */
type DetailsFailure = "secret-value-detected" | "unsupported-shape";
type SnapshotResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: DetailsFailure };

/**
 * Validate AND copy in one pass, returning a DETACHED snapshot.
 *
 * Scanning then storing the caller's object was necessary but not sufficient:
 * the receipt held a live reference, so mutating the caller's object after
 * `create()` changed the stored record. Measured before this change, injecting
 * a credential into a nested caller object AFTER creation made it appear in
 * `JSON.stringify(log.list())` — a validated receipt silently became unsafe.
 * A receipt is an accountability record; what it says must be what was checked.
 *
 * Copying happens during the same walk that validates, so there is no window
 * between the two and no second traversal to keep in step.
 */
function snapshotDetails(node: unknown, depth: number, seen: Set<object>): SnapshotResult {
  // Guards a pathological structure without needing a cycle to exist.
  if (depth > 32) return { ok: false, reason: "unsupported-shape" };

  if (node === null || node === undefined) return { ok: true, value: node };

  const kind = typeof node;
  if (kind === "number" || kind === "boolean") return { ok: true, value: node };
  if (kind === "string") {
    return containsSecretValue(node as string) ? { ok: false, reason: "secret-value-detected" } : { ok: true, value: node };
  }
  // A function, symbol or bigint cannot be scanned meaningfully and does not
  // occur in any current call site, so it is refused rather than ignored.
  if (kind !== "object") return { ok: false, reason: "unsupported-shape" };

  const obj = node as object;
  // `seen` holds the current ANCESTOR PATH, not every node ever visited. Only
  // an ancestor forms a cycle; the same object appearing twice in sibling
  // branches is an ordinary shared reference and must stay acceptable. Tracking
  // all visited nodes instead would refuse legitimate receipts.
  if (seen.has(obj)) return { ok: false, reason: "unsupported-shape" }; // genuinely cyclic
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      // An array is inspected by own property too, not just iterated. Iteration
      // reads indices and would walk straight past an extra string key, a
      // symbol key, or an accessor installed on an index.
      //
      // A dense array's own keys are exactly its index keys plus the standard
      // non-enumerable `length`. `length` is EXPECTED, not an attack: it is
      // accounted for by the `+ 1` and is never copied, since it follows from
      // the elements. Any other surplus key fails closed, and so does a hole
      // (a sparse array is missing an index key, so the count falls short).
      const ownKeyCount = Reflect.ownKeys(obj).length;
      if (ownKeyCount !== obj.length + 1) return { ok: false, reason: "unsupported-shape" };

      const copy: unknown[] = [];
      for (let index = 0; index < obj.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(obj, String(index));
        if (!descriptor || !("value" in descriptor)) return { ok: false, reason: "unsupported-shape" };
        const r = snapshotDetails(descriptor.value, depth + 1, seen);
        if (!r.ok) return r;
        copy.push(r.value);
      }
      return { ok: true, value: copy };
    }

    // Plain objects only. A Date, Error, Map, Set or class instance may hide
    // state behind a prototype this walk would never see.
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) return { ok: false, reason: "unsupported-shape" };

    // `Object.keys` sees only ENUMERABLE STRING keys. A non-enumerable or
    // symbol-keyed property would slip past it entirely, so own keys are
    // enumerated with Reflect and any surplus fails closed. Silently dropping
    // them would also keep them out of the snapshot, but refusing is honest:
    // a caller smuggling a credential into a hidden slot learns it was refused
    // rather than believing the receipt recorded it.
    const enumerableStringKeys = Object.keys(obj);
    if (Reflect.ownKeys(obj).length !== enumerableStringKeys.length) return { ok: false, reason: "unsupported-shape" };

    const copy: Record<string, unknown> = {};
    for (const key of enumerableStringKeys) {
      // A key can itself carry a credential.
      if (containsSecretValue(key)) return { ok: false, reason: "secret-value-detected" };
      const descriptor = Object.getOwnPropertyDescriptor(obj, key);
      // An ACCESSOR descriptor has no `value` key at all, so this one test
      // refuses get-only, set-only and get+set alike — and refuses them WITHOUT
      // invoking anything. Reading `obj[key]` instead would run caller code,
      // which may have side effects or may return a different value than the
      // one a later reader would see. Testing `descriptor.get` alone would let
      // a setter-only property through as `undefined`.
      if (!descriptor || !("value" in descriptor)) return { ok: false, reason: "unsupported-shape" };
      const r = snapshotDetails(descriptor.value, depth + 1, seen);
      if (!r.ok) return r;
      copy[key] = r.value;
    }
    return { ok: true, value: copy };
  } finally {
    seen.delete(obj);
  }
}

/**
 * Freeze a stored receipt in place, depth-first.
 *
 * `list()` and `linkedTo()` hand out the receipt objects themselves, so without
 * this a caller could edit a returned receipt — its summary, its status, its
 * links, or anything nested in its details — and change what the NEXT read
 * reports. An audit record a reader can rewrite is not an audit record.
 * Measured before this change, assigning through `list()[0].details` was
 * visible in a subsequent `list()`.
 *
 * Applied to the receipt as a whole rather than to details alone, because
 * `links` and the scalar fields are equally part of the record. Everything it
 * walks is either a validated JSON-like snapshot or a freshly copied `links`
 * object, so the traversal is total and no cycle can exist to loop on.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

export class ReceiptLog {
  private readonly receipts: ActionReceipt[] = [];

  /**
   * AH2 Step 4F: instance-owned receipt sequence. Every ReceiptLog starts
   * its own sequence at 1, so the first receipt of any log is always
   * "receipt-1", creating receipts in one log never advances another, and
   * identity is deterministic (no randomness, wall-clock, process, or
   * environment input). Receipt ids are therefore scoped to their log;
   * components that need linked ids must share the injected ReceiptLog.
   */
  private sequence = 0;

  private nextReceiptId(): string {
    this.sequence += 1;
    return `receipt-${this.sequence}`;
  }

  create(params: {
    summary: string;
    status: ReceiptStatus;
    links?: ReceiptLink;
    details?: Record<string, unknown>;
  }): ActionReceipt {
    // EVERY refusal happens before ANY mutation: no receipt id is consumed, the
    // sequence does not advance, and nothing is pushed. A rejected secret must
    // not leave a gap in the id series that looks like a deleted record.
    if (looksLikeSecret(params.summary)) {
      throw new Error("ReceiptLog refused to store a receipt whose summary looks like a secret.");
    }

    let safeDetails: Record<string, unknown> | undefined;
    if (params.details !== undefined) {
      const snapshot = snapshotDetails(params.details, 0, new Set<object>());
      if (!snapshot.ok) {
        // Each message names the FIELD and nothing else — never the value, its
        // key path, its length, or a digest.
        if (snapshot.reason === "secret-value-detected") {
          throw new Error("ReceiptLog refused to store a receipt whose details contain a secret value.");
        }
        throw new Error("ReceiptLog refused to store a receipt whose details are not plain JSON-like data.");
      }
      // Not frozen here: the whole receipt is deep-frozen once below, which
      // reaches this snapshot. Freezing twice would just be two places to keep
      // in step.
      safeDetails = snapshot.value as Record<string, unknown>;
    }

    const receipt: ActionReceipt = deepFreeze({
      receiptId: this.nextReceiptId(),
      summary: params.summary,
      status: params.status,
      // Copied, not referenced: `links` is a caller-owned object, so storing it
      // directly would leave the same post-create mutation hole the details
      // snapshot closes.
      links: { ...params.links },
      createdAt: new Date().toISOString(),
      // The DETACHED, frozen snapshot — never the caller's object. Mutating the
      // original after this point cannot change what the receipt records.
      details: safeDetails,
    });

    this.receipts.push(receipt);
    return receipt;
  }

  /**
   * The receipt objects themselves are handed out, which is safe ONLY because
   * every one of them was deep-frozen at creation.
   *
   * Freezing once at the boundary was chosen over deep-copying on every read:
   * there is one place to get right instead of one per accessor, the cost does
   * not grow with the number of readers, and `create()` already had to build a
   * detached snapshot, so the frozen object IS the stored state rather than a
   * defensive imitation of it. Measured across the 41 demos, no call site
   * mutates a receipt, so nothing legitimate is constrained by this.
   */
  list(): ActionReceipt[] {
    return [...this.receipts];
  }

  /**
   * Shares the exposure boundary above: `filter` builds a new array, and the
   * receipts inside it are the same frozen objects `list()` returns.
   */
  linkedTo(link: Partial<ReceiptLink>): ActionReceipt[] {
    return this.receipts.filter((receipt) =>
      Object.entries(link).every(([key, value]) => receipt.links[key as keyof ReceiptLink] === value)
    );
  }
}
