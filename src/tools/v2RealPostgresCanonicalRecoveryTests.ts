/**
 * 10E6 real PostgreSQL 16 recovery-storage integration proof.
 * Explicitly opt-in; uses ONLY the separately pinned, loopback test database.
 * Creates a fresh random schema and retains it. Never drops schemas, stops the
 * database, executes factories or treats a test fixture as execution authority.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { Pool, type PoolConfig } from "pg";
import { PgCheckpointDatabase } from "../v2/persistence/pgCheckpointDatabase";
import type { PostgresCheckpointDatabase, PostgresCheckpointClient,
  PostgresCheckpointQueryResult } from "../v2/persistence/postgresMissionCheckpointStore";
import { migrateV2MissionCheckpointSchema } from "../v2/persistence/postgresMissionCheckpointMigration";
import { migrateV2ExecutionAuthoritySchema } from "../v2/persistence/postgresExecutionAuthorityMigration";
import { migrateV2CanonicalRuntimeCursorSchema } from "../v2/persistence/postgresCanonicalRuntimeCursorMigration";
import { migrateV2CanonicalRuntimeRecoverySchema as migrateRecovery,
  V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_MIGRATION_NAME as MIGRATION_NAME,
} from "../v2/persistence/postgresCanonicalRuntimeRecoveryMigration";
import { PostgresCanonicalRuntimeRecoveryStore as Store } from "../v2/persistence/postgresCanonicalRuntimeRecoveryStore";
import { DurableCanonicalRuntimeRecoverySession as Session } from "../v2/persistence/durableCanonicalRuntimeRecoverySession";
import { V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_TABLE as TABLE } from "../v2/persistence/postgresCanonicalRuntimeRecoverySchema";
import { V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA as SCHEMA,
  type CanonicalRuntimeRecoveryCheckpoint as Checkpoint,
} from "../v2/persistence/canonicalRuntimeRecoveryCheckpoint";
import { CANONICAL_PIPELINE_SEQUENCE } from "../v2/architecture/canonicalPipelineRegistry";
import { V2_NAMLA_LOOP_GATE_STATE_SCHEMA } from "../v2/loop/namlaLoopGate";
import { createCanonicalRuntimeCursor, type CanonicalRuntimeCursor } from "../v2/runtime/canonicalRuntimeStepper";
import { captureCanonicalFrozenPlanContract, type CanonicalFrozenPlanContractIdentity as Pin,
} from "../v2/protocol/canonicalFrozenPlanContract";

const CONTAINER_ID = "2b22f4d4d1870376e91a2d03c6c368f2d77b06bd15cef50e253cd9de3c1050fc";
const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
async function within<T>(pending: Promise<T>, ms: number, reason: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([pending, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(reason)), ms);
  })]); } finally { if (timer) clearTimeout(timer); }
}
function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function readTarget() {
  must(process.env.NAMLA_10E6_REAL_PG_PROOF_ENABLED === "YES_LOCAL_TEST_SCHEMA_ONLY", "10E6_LIVE_PROOF_NOT_ENABLED");
  must(process.env.NAMLA_10E6_TEST_CONTAINER_ID === CONTAINER_ID, "10E6_CONTAINER_PIN_REQUIRED");
  must(process.env.NAMLA_10E6_TEST_DOCKER_CONTEXT === "desktop-linux", "10E6_CONTEXT_PIN_REQUIRED");
  must(process.env.NAMLA_10E6_TEST_VOLUME_NAME === "namla-10e6-pg-test-data", "10E6_VOLUME_PIN_REQUIRED");
  const cluster = process.env.NAMLA_10E6_TEST_CLUSTER_NAME;
  const systemId = process.env.NAMLA_10E6_TEST_SYSTEM_IDENTIFIER;
  must(typeof cluster === "string" && /^namla10e6_[0-9a-f]{32}$/.test(cluster), "10E6_CLUSTER_PIN_REQUIRED");
  must(typeof systemId === "string" && /^[0-9]{1,20}$/.test(systemId), "10E6_SYSTEM_PIN_REQUIRED");
  const raw = process.env.NAMLA_10E6_TEST_DATABASE_URL;
  must(typeof raw === "string" && raw.length > 0, "10E6_TEST_URL_REQUIRED_NO_DATABASE_URL_FALLBACK");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("10E6_TEST_URL_INVALID"); }
  must(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "127.0.0.1" &&
    url.username === "namla_10e6_test" && url.pathname === "/namla_10e6_test" &&
    url.search === "" && url.hash === "" && /^[0-9a-f]{64}$/.test(url.password), "10E6_TEST_URL_TARGET_REFUSED");
  const port = Number(url.port);
  must(Number.isInteger(port) && port > 0 && port <= 65535, "10E6_TEST_PORT_INVALID");
  return { cluster, systemId, config: {
    host: "127.0.0.1", port, user: "namla_10e6_test", database: "namla_10e6_test",
    password: url.password, ssl: false, max: 1, connectionTimeoutMillis: 10_000,
    query_timeout: 15_000, application_name: "namla10e6_recovery_live_proof",
  } satisfies PoolConfig };
}
function diagnostic(error: unknown): Error {
  const raw = error as { code?: unknown; message?: unknown } | null;
  const code = typeof raw?.code === "string" && /^[A-Z0-9_]{2,48}$/.test(raw.code) ? raw.code : "NO_CODE";
  let message = typeof raw?.message === "string" ? raw.message : "Unknown failure";
  // No error objects, causes, stacks containing connection configuration, or URLs.
  const url = process.env.NAMLA_10E6_TEST_DATABASE_URL;
  if (url) {
    message = message.split(url).join("[REDACTED_URL]");
    try { message = message.split(new URL(url).password).join("[REDACTED]"); } catch { /* no raw parser error */ }
  }
  message = message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED_URL]")
    .replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 700);
  return new Error(`10E6_REAL_PG_FAILURE:${code}:${message}`);
}
async function verifyTarget(pool: Pool, target: ReturnType<typeof readTarget>): Promise<void> {
  const result = await pool.query(`SELECT current_database() AS db, current_user::text AS role,
    current_setting('cluster_name') AS cluster, current_setting('server_version_num') AS version,
    current_setting('fsync') AS fsync, current_setting('synchronous_commit') AS sync,
    current_setting('full_page_writes') AS pages,
    (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS system_id`);
  const r = result.rows[0];
  must(result.rows.length === 1 && r.db === "namla_10e6_test" && r.role === "namla_10e6_test" &&
    r.cluster === target.cluster && r.system_id === target.systemId && Number(r.version) >= 160000 &&
    Number(r.version) < 170000 && r.fsync === "on" && r.sync === "on" && r.pages === "on",
    "10E6_LIVE_DATABASE_IDENTITY_OR_DURABILITY_MISMATCH");
}
function initial(missionId: string): Checkpoint {
  return { schemaVersion: SCHEMA, missionId, checkpointVersion: 1,
    cursor: createCanonicalRuntimeCursor(missionId), savedAt: 1000,
    loopBudget: { maxTicks: 100, remainingTicks: 100, maxProviderCalls: 10,
      remainingProviderCalls: 10, maxFixAttempts: 3, remainingFixAttempts: 3 },
    gateStates: CANONICAL_PIPELINE_SEQUENCE.flatMap((node) => node.kind === "GATE" ? [{
      schemaVersion: V2_NAMLA_LOOP_GATE_STATE_SCHEMA, missionId, stageId: node.id,
      workPackageId: null, maxLivelockThreshold: 3, livelockCounter: 0,
    }] : []), failureCount: 0, frozenContract: null };
}
function revised(current: Checkpoint, patch: Partial<Checkpoint> = {}): Checkpoint {
  return { ...current, checkpointVersion: current.checkpointVersion + 1, savedAt: current.savedAt + 1, ...patch };
}
function cursorAt(missionId: string, nodeId: CanonicalRuntimeCursor["nodeId"]): CanonicalRuntimeCursor {
  const index = CANONICAL_PIPELINE_SEQUENCE.findIndex((n) => n.id === nodeId);
  const node = CANONICAL_PIPELINE_SEQUENCE[index];
  must(node, "10E6_FIXTURE_NODE_MISSING");
  const pro = CANONICAL_PIPELINE_SEQUENCE.findIndex((n) => n.id === "PRO");
  return { ...createCanonicalRuntimeCursor(missionId), nodeIndex: index, nodeId, nodeKind: node.kind,
    stepVersion: index + 1, contractPhase: index < pro ? "PRE_FREEZE" : "CONTRACT_BOUND" };
}
function frozen(missionId: string) {
  // Content fixture, NOT approval by PLAN_TEST or proof that any factory ran.
  const raw = { contractId: `contract-${missionId}`, version: "v1.0.0", objective: "Persist exact frozen bytes",
    acceptanceCriteria: [{ id: "ac-1", description: "Round trip", verificationMethod: "TEST" as const, required: true }],
    constraints: [], tasks: [{ id: "t1", name: "Save", description: "Save", targetFiles: ["out.txt"],
      dependencies: [], capabilityRequirements: [] }], dependencies: [], allowedCapabilities: [], requiredTests: [],
    securityRequirements: [], expectedArtifacts: [], evidenceRequirements: [], riskClassification: "LOW" as const,
    completionConditions: [], frozenAt: 900 };
  const hash = createHash("sha256").update(JSON.stringify(raw)).digest("hex");
  const captured = captureCanonicalFrozenPlanContract(missionId, { ...raw, contractHash: hash });
  must(captured.ok, "10E6_CONTRACT_FIXTURE_REFUSED");
  const pin: Pin = { missionId, contractId: raw.contractId, contractVersion: raw.version, contractHash: hash };
  return { binding: captured.binding, pin };
}

/** Fault injection AFTER real SQL, BEFORE the real transaction callback returns. */
class BadReceiptDatabase implements PostgresCheckpointDatabase {
  public injected = false;
  constructor(private readonly real: PgCheckpointDatabase, private readonly verb: "INSERT" | "UPDATE") {}
  query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<PostgresCheckpointQueryResult<T>> {
    return this.real.query<T>(sql, params);
  }
  transaction<T>(work: (client: PostgresCheckpointClient) => Promise<T>): Promise<T> {
    return this.real.transaction(async (client) => work({ query: async <R = unknown>(sql: string, params?: readonly unknown[]) => {
      const result = await client.query<R>(sql, params);
      if (!this.injected && sql.trimStart().startsWith(this.verb + " ") && sql.includes(TABLE) && result.rows.length === 1) {
        const rows = structuredClone(result.rows) as unknown as Record<string, unknown>[];
        const cp = rows[0].checkpoint as Checkpoint;
        rows[0].checkpoint = { ...cp, loopBudget: { ...cp.loopBudget, remainingTicks: cp.loopBudget.remainingTicks - 1 } };
        this.injected = true;
        return { ...result, rows: rows as unknown as readonly R[] };
      }
      return result;
    } }));
  }
}

// This trusted child script is used only by the explicit process-loss test.
// The child is our own Node process, never the PostgreSQL server or another app.
const CHILD_SOURCE = String.raw`
'use strict';
const { Pool } = require('pg');
const path = require('node:path');
const base = process.env.NAMLA_10E6_CHILD_MODULE_BASE;
const { PgCheckpointDatabase } = require(path.join(base, 'persistence/pgCheckpointDatabase.js'));
const { PostgresCanonicalRuntimeRecoveryStore } = require(path.join(base, 'persistence/postgresCanonicalRuntimeRecoveryStore.js'));
const { DurableCanonicalRuntimeRecoverySession } = require(path.join(base, 'persistence/durableCanonicalRuntimeRecoverySession.js'));
let pool;
let phase = 'CHILD_CONFIG';
const timer = setTimeout(() => process.exit(91), 40000);
process.once('message', async (m) => {
  try {
    if (process.env.NAMLA_10E6_REAL_PG_PROOF_ENABLED !== 'YES_LOCAL_TEST_SCHEMA_ONLY' ||
        !m || !/^namla10e6_recovery_[0-9a-f]{32}$/.test(m.schema) || !['commit', 'resume'].includes(m.action)) throw new Error();
    const u = new URL(process.env.NAMLA_10E6_TEST_DATABASE_URL);
    if (u.hostname !== '127.0.0.1' || u.username !== 'namla_10e6_test' || u.pathname !== '/namla_10e6_test' || u.search || u.hash) throw new Error();
    pool = new Pool({ host: '127.0.0.1', port: Number(u.port), user: u.username,
      password: u.password, database: 'namla_10e6_test', ssl: false, max: 1,
      connectionTimeoutMillis: 10000, query_timeout: 15000,
      options: '-c search_path=' + m.schema + ' -c statement_timeout=12000 -c lock_timeout=8000 -c synchronous_commit=on' });
    pool.on('error', () => {});
    phase = 'CHILD_IDENTITY';
    const r = (await pool.query("SELECT current_database() AS db, current_user::text AS role, current_schema() AS schema, current_setting('cluster_name') AS cluster, (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS system_id")).rows[0];
    if (r.db !== 'namla_10e6_test' || r.role !== 'namla_10e6_test' || r.schema !== m.schema ||
        r.cluster !== process.env.NAMLA_10E6_TEST_CLUSTER_NAME || r.system_id !== process.env.NAMLA_10E6_TEST_SYSTEM_IDENTIFIER) throw new Error();
    const store = new PostgresCanonicalRuntimeRecoveryStore(new PgCheckpointDatabase(pool));
    const session = new DurableCanonicalRuntimeRecoverySession(store, m.missionId);
    if (m.action === 'commit') {
      phase = 'CHILD_CREATE_AND_CAS';
      if (!(await session.createInitial(m.initial)).ok) throw new Error();
      for (const next of m.updates) if (!(await session.advance(next, null)).ok) throw new Error();
      process.send({ type: 'COMMITTED', checkpoint: session.getSnapshot() });
      // Hold open so the parent can kill this process, without graceful cleanup.
      setInterval(() => {}, 1000);
    } else {
      phase = 'CHILD_RESUME';
      const loaded = await session.resume(null);
      if (!loaded.ok) throw new Error();
      await pool.end(); pool = null;
      process.send({ type: 'RESUMED', checkpoint: loaded.checkpoint }, () => {
        clearTimeout(timer); process.disconnect();
      });
    }
  } catch (error) {
    // Only classification and execution phase; no config, URL or error object.
    const code = error && typeof error.code === 'string' && /^[A-Z0-9_]{2,48}$/.test(error.code) ? error.code : 'NO_CODE';
    process.send({ type: 'FAILED', phase, code }, () => process.exit(92));
  }
});
`;
async function childResult(message: Record<string, unknown>, crash: boolean) {
  const child: ChildProcess = spawn(process.execPath, ["-e", CHILD_SOURCE], {
    cwd: process.cwd(), env: { ...process.env, NAMLA_10E6_CHILD_MODULE_BASE: resolve(__dirname, "../v2") },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => {
    child.once("close", (code, signal) => done({ code, signal }));
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = await new Promise<Record<string, unknown>>((done, reject) => {
      timeout = setTimeout(() => reject(new Error("10E6_OWN_CHILD_RESPONSE_TIMEOUT")), 30_000);
      child.once("error", () => reject(new Error("10E6_OWN_CHILD_START_FAILED")));
      child.once("close", () => reject(new Error("10E6_OWN_CHILD_EXITED_BEFORE_RECEIPT")));
      child.once("message", (raw) => {
        const failure = raw as { type?: string; phase?: string; code?: string } | null;
        if (failure?.type === "FAILED") {
          const phase = typeof failure.phase === "string" && /^[A-Z_]{1,60}$/.test(failure.phase) ? failure.phase : "UNKNOWN";
          const code = typeof failure.code === "string" && /^[A-Z0-9_]{2,48}$/.test(failure.code) ? failure.code : "NO_CODE";
          reject(new Error(`10E6_OWN_CHILD_FAILED:${phase}:${code}`)); return;
        }
        if (!raw || typeof raw !== "object" || (raw as { type?: unknown }).type !== (crash ? "COMMITTED" : "RESUMED")) {
          reject(new Error("10E6_OWN_CHILD_RECEIPT_INVALID")); return;
        }
        done(raw as Record<string, unknown>);
      });
      child.send!(message, (error) => { if (error) reject(new Error("10E6_OWN_CHILD_IPC_FAILED")); });
    });
    if (timeout) clearTimeout(timeout);
    if (crash) must(child.kill("SIGKILL"), "10E6_OWN_CHILD_TERMINATION_FAILED");
    const exit = await within(closed, 10_000, "10E6_OWN_CHILD_EXIT_TIMEOUT");
    if (crash) must(exit.code !== 0 || exit.signal !== null, "10E6_EXPECTED_ABRUPT_CHILD_EXIT");
    else assert.equal(exit.code, 0);
    return answer.checkpoint as Checkpoint;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await within(closed, 3000, "10E6_OWN_CHILD_CLEANUP_TIMEOUT");
  }
}

test("10E6 LIVE PostgreSQL recovery storage proof (isolated test schema)", { timeout: 180_000 }, async (t) => {
  const target = readTarget();
  const schema = "namla10e6_recovery_" + randomUUID().replace(/-/g, "");
  const pools = new Set<Pool>();
  let poolError: unknown = null;
  let created = false;
  let completed = 0;
  function poolFor(searchPath: string): Pool {
    must(searchPath === "pg_catalog" || searchPath === schema, "10E6_SEARCH_PATH_REFUSED");
    const pool = new Pool({ ...target.config,
      options: `-c search_path=${searchPath} -c statement_timeout=12000 -c lock_timeout=8000 -c idle_in_transaction_session_timeout=20000 -c synchronous_commit=on` });
    pool.on("error", (error: Error) => { poolError = error; });
    pools.add(pool); return pool;
  }
  async function closePool(pool: Pool) { await pool.end(); pools.delete(pool); }
  async function check(name: string, work: () => Promise<void>) {
    let failed = false;
    await t.test(name, async () => {
      try { await work(); if (poolError) throw poolError; completed += 1; }
      catch (error) { failed = true; throw diagnostic(error); }
    });
    if (failed) throw new Error("10E6_LIVE_PROOF_STOPPED_AFTER_FAILED_CHECK");
  }
  const admin = poolFor("pg_catalog");
  try {
    await verifyTarget(admin, target); // No writes before this identity check.
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    console.log("LIVE_TEST_SCHEMA=" + schema);
    const a = poolFor(schema); const b = poolFor(schema);
    await verifyTarget(a, target); await verifyTarget(b, target);
    for (const pool of [a, b]) {
      const r = await pool.query("SELECT current_schema() AS schema, current_schemas(false)::text[] AS path");
      assert.equal(r.rows[0].schema, schema); assert.deepEqual(r.rows[0].path, [schema]);
    }
    const dbA = new PgCheckpointDatabase(a); const dbB = new PgCheckpointDatabase(b);
    const storeA = new Store(dbA); const storeB = new Store(dbB);

    await check("migration 4 missing prerequisite rolls back its new ledger on the real server", async () => {
      await assert.rejects(migrateRecovery(dbA), /PG_RECOVERY_MIGRATION_PREREQUISITE_MISSING:1/);
      const r = await a.query("SELECT pg_catalog.to_regclass('namla_v2_schema_migrations')::text AS ledger");
      assert.equal(r.rows[0].ledger, null);
    });
    await check("migrations 1-3 and two competing migration-4 writers produce one exact receipt", async () => {
      await migrateV2MissionCheckpointSchema(dbA);
      await migrateV2ExecutionAuthoritySchema(dbA);
      await migrateV2CanonicalRuntimeCursorSchema(dbA);
      const outcomes = await Promise.all([migrateRecovery(dbA), migrateRecovery(dbB)]);
      assert.deepEqual(outcomes.sort(), ["ALREADY_APPLIED", "APPLIED"]);
      const r = await a.query("SELECT version::text, name FROM namla_v2_schema_migrations ORDER BY version");
      assert.deepEqual(r.rows.map((row) => row.version), ["1", "2", "3", "4"]);
      assert.equal(r.rows[3].name, MIGRATION_NAME);
      assert.equal(await migrateRecovery(dbB), "ALREADY_APPLIED");
      const tables = await a.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = $1 ORDER BY tablename", [schema]);
      assert.ok(tables.rows.some((row) => row.tablename === TABLE));
    });
    await check("real SQL rejects missing null extra mistyped and fractional recovery JSON", async () => {
      const cp = initial("live-invalid-json");
      const cases: unknown[] = [{}, null, [], { ...cp, extra: true }, { ...cp, schemaVersion: "v1" },
        { ...cp, checkpointVersion: "1" }, { ...cp, failureCount: 0.5 },
        { ...cp, loopBudget: { ...cp.loopBudget, remainingTicks: 101 } },
        { ...cp, cursor: { ...cp.cursor, stepVersion: "1" } },
        { ...cp, gateStates: cp.gateStates.slice(1) },
        { ...cp, frozenContract: {} }];
      for (const key of Object.keys(cp)) { const partial = { ...cp } as Record<string, unknown>; delete partial[key]; cases.push(partial); }
      for (const key of Object.keys(cp.cursor)) {
        const cursor = { ...cp.cursor } as Record<string, unknown>; delete cursor[key]; cases.push({ ...cp, cursor });
      }
      const client = await a.connect();
      try {
        await client.query("BEGIN");
        for (const value of cases) {
          await client.query("SAVEPOINT invalid_json");
          let rejected = false;
          try {
            await client.query(`INSERT INTO ${TABLE} (mission_id, schema_version, checkpoint_version, cursor_step_version, checkpoint, saved_at)
              VALUES ($1,$2,1,1,$3::jsonb,1000)`, [cp.missionId, SCHEMA, JSON.stringify(value)]);
          } catch (error) {
            assert.ok(["23514", "22P02"].includes(String((error as { code?: string }).code)), "Expected a CHECK/type rejection, not infrastructure failure");
            rejected = true;
          }
          await client.query("ROLLBACK TO SAVEPOINT invalid_json");
          await client.query("RELEASE SAVEPOINT invalid_json");
          assert.ok(rejected, "Malformed recovery JSON was accepted");
        }
      } finally { try { await client.query("ROLLBACK"); } finally { client.release(); } }
      assert.equal(await storeA.load(cp.missionId, null), null);
      console.log("LIVE_SQL_NEGATIVE_CASES=" + cases.length);
    });
    await check("real insert-only create and load round-trip the complete v2 snapshot", async () => {
      const cp = initial("live-create");
      assert.equal(await storeA.create(cp), "CREATED");
      assert.equal(await storeB.create({ ...cp, loopBudget: { ...cp.loopBudget, remainingTicks: 90 } }), "ALREADY_EXISTS");
      assert.deepEqual(await storeB.load(cp.missionId, null), cp);
    });
    await check("same-node debit survives closing the pool and explicit fresh-session resume", async () => {
      const firstPool = poolFor(schema); const cp = initial("live-fresh-session");
      const session = new Session(new Store(new PgCheckpointDatabase(firstPool)), cp.missionId);
      assert.ok((await session.createInitial(cp)).ok);
      const next = revised(cp, { loopBudget: { ...cp.loopBudget, remainingTicks: 87, remainingProviderCalls: 7, remainingFixAttempts: 2 } });
      assert.ok((await session.advance(next, null)).ok);
      await closePool(firstPool);
      const reopened = new Session(storeB, cp.missionId);
      const loaded = await reopened.resume(null);
      assert.ok(loaded.ok); assert.deepEqual(loaded.checkpoint, next);
    });
    await check("two blocked real row-lock writers yield one CAS winner and one conflict", async () => {
      // 10E6_LOCK_OBSERVER_V2: follow only the three participating backends.
      // pg_blocking_pids can expose an intermediate queued writer, not just
      // the transaction that initially locked the row. Do not require a star.
      // PostgreSQL 16: functions-info.html#FUNCTIONS-INFO-SESSION
      interface LockObservation {
        readonly pid: number;
        readonly state: string | null;
        readonly wait_event_type: string | null;
        readonly wait_event: string | null;
        readonly blockers: readonly number[];
      }
      function pathToHolder(
        writerPid: number,
        holderPid: number,
        snapshot: readonly LockObservation[],
      ): readonly number[] | null {
        const graph = new Map(snapshot.map((row) => [row.pid, row.blockers] as const));
        const visit = (pid: number, trail: readonly number[]): readonly number[] | null => {
          if (!graph.has(pid) || trail.includes(pid)) return null;
          const path = [...trail, pid];
          if (pid === holderPid) return path;
          for (const blocker of graph.get(pid)!) {
            const result = visit(blocker, path);
            if (result) return result;
          }
          return null;
        };
        return visit(writerPid, []);
      }
      function observedWriterPaths(
        snapshot: readonly LockObservation[],
        holderPid: number,
        writerPids: readonly number[],
      ): readonly (readonly number[])[] | null {
        if (writerPids.length !== 2 || new Set([holderPid, ...writerPids]).size !== 3 ||
            snapshot.length !== 3 || new Set(snapshot.map((row) => row.pid)).size !== 3) return null;
        const participants = new Set([holderPid, ...writerPids]);
        for (const row of snapshot) {
          if (!participants.has(row.pid) || !Array.isArray(row.blockers) ||
              row.blockers.some((pid) => !participants.has(pid))) return null;
        }
        const holder = snapshot.find((row) => row.pid === holderPid);
        if (!holder || holder.state !== "idle in transaction" || holder.blockers.length !== 0) return null;
        const paths: (readonly number[])[] = [];
        for (const pid of writerPids) {
          const row = snapshot.find((sample) => sample.pid === pid);
          if (!row || row.state !== "active" || row.wait_event_type !== "Lock" ||
              !["transactionid", "tuple"].includes(row.wait_event ?? "")) return null;
          const path = pathToHolder(pid, holderPid, snapshot);
          if (!path || path.length < 2) return null;
          paths.push(path);
        }
        return paths;
      }

      const cp = initial("live-row-lock"); await storeA.create(cp);
      const c = poolFor(schema); const dbC = new PgCheckpointDatabase(c); const storeC = new Store(dbC);
      // Each pool has max=1; no other operation uses B or C during this check.
      const pidB = Number((await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      const pidC = Number((await c.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      assert.notEqual(pidB, pidC);
      const holder = await a.connect(); let active = false;
      // COMMIT ends the transaction, but does not return a checked-out client
      // to its pool. A has max=1: release before storeA.load uses pool.query.
      // Keep ownership explicit so error cleanup never releases it twice.
      let holderReleased = false;
      const releaseHolder = (destroy = false): void => {
        if (holderReleased) return;
        holderReleased = true;
        holder.release(destroy);
      };
      type CasValue = Awaited<ReturnType<Store["compareAndSet"]>>;
      let pending: Promise<PromiseSettledResult<CasValue>[]> | undefined;
      const writerStates = ["pending", "pending"];
      const writerErrors: (string | null)[] = [null, null];
      let lastObservation: readonly LockObservation[] = [];
      let lastPaths: readonly (readonly number[])[] | null = null;
      let holderPid = 0;
      const emitObservation = (outcome: string) => {
        // Test PID/state/lock metadata only. Never print SQL, params, a URL,
        // a checkpoint body or an unsanitized exception.
        console.log("LIVE_ROW_LOCK_GRAPH=" + JSON.stringify({
          observerVersion: 2, outcome, holderPid, writerPids: [pidB, pidC],
          writerStates, writerErrors, observations: lastObservation, paths: lastPaths,
        }));
      };
      try {
        await holder.query("BEGIN"); active = true;
        holderPid = Number((await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
        assert.equal(new Set([holderPid, pidB, pidC]).size, 3, "Holder and writers require distinct backends");
        const held = await holder.query(`SELECT mission_id FROM ${TABLE} WHERE mission_id=$1 FOR UPDATE`, [cp.missionId]);
        assert.equal(held.rows.length, 1, "The holder must actually lock the existing target row");
        assert.equal(held.rows[0].mission_id, cp.missionId);
        const nextB = revised(cp, { loopBudget: { ...cp.loopBudget, remainingTicks: 91 } });
        const nextC = revised(cp, { loopBudget: { ...cp.loopBudget, remainingTicks: 82 } });
        const track = (operation: Promise<CasValue>, index: number): Promise<CasValue> => operation.then(
          (value) => { writerStates[index] = "fulfilled"; return value; },
          (error: unknown) => {
            writerStates[index] = "rejected";
            writerErrors[index] = diagnostic(error).message;
            throw error;
          },
        );
        pending = Promise.allSettled([
          track(storeB.compareAndSet(cp.missionId, 1, nextB, null, null), 0),
          track(storeC.compareAndSet(cp.missionId, 1, nextC, null, null), 1),
        ]);
        // Keep the original four-second observation window. No sleep-based
        // substitute for observing two genuine lock waits on the real server.
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline) {
          // Admin is a separate connection in autocommit: each observation is
          // a new statement, not a cached pg_stat_activity transaction snapshot.
          const locks = await admin.query<LockObservation>(`
            SELECT pid, state, wait_event_type, wait_event,
              pg_catalog.pg_blocking_pids(pid) AS blockers
            FROM pg_catalog.pg_stat_activity
            WHERE datname = current_database() AND pid = ANY($1::int[])
            ORDER BY pid`, [[holderPid, pidB, pidC]]);
          lastObservation = locks.rows;
          lastPaths = observedWriterPaths(lastObservation, holderPid, [pidB, pidC]);
          if (writerStates.some((state) => state !== "pending")) {
            emitObservation("WRITER_FINISHED_BEFORE_HOLDER_RELEASE");
            assert.fail("Both CAS calls must remain pending while the holder retains the target row lock");
          }
          if (lastPaths) break;
          await wait(40);
        }
        emitObservation(lastPaths ? "BOTH_WRITERS_REACH_HOLDER" : "OBSERVATION_TIMEOUT");
        assert.ok(lastPaths,
          "Both writers must be observed in Lock waits with direct or queued paths to the actual holder");
        await holder.query("COMMIT"); active = false;
        releaseHolder();
        const poolState = { total: a.totalCount, idle: a.idleCount, waiting: a.waitingCount };
        console.log("LIVE_ROW_LOCK_HOLDER_POOL=" + JSON.stringify(poolState));
        assert.deepEqual(poolState, { total: 1, idle: 1, waiting: 0 },
          "The single holder connection must be back in pool A before its snapshot read");
        const outcomes = await pending;
        const values = outcomes.map((result) => {
          if (result.status === "rejected") throw diagnostic(result.reason);
          return result.value;
        });
        assert.deepEqual(values.map((value) => value.status).sort(), ["UPDATED", "VERSION_CONFLICT"]);
        const winner = values[0].status === "UPDATED" ? 0 : 1;
        assert.deepEqual(values[winner], { status: "UPDATED", checkpointVersion: 2 });
        assert.deepEqual(values[1 - winner], { status: "VERSION_CONFLICT", currentCheckpointVersion: 2 });
        assert.deepEqual(await storeA.load(cp.missionId, null), winner === 0 ? nextB : nextC);
        console.log("LIVE_ROW_LOCK_CAS=ONE_WINNER_ONE_CONFLICT_FULL_SNAPSHOT_VERIFIED");
      } finally {
        try {
          if (!holderReleased) {
            let destroy = false;
            try { if (active) { await holder.query("ROLLBACK"); active = false; } }
            catch (error) { destroy = true; throw error; }
            finally { releaseHolder(destroy); }
          }
        } finally {
          // Settle the two operations and close their test-only third pool
          // even if releasing or rolling back the holder itself fails.
          try { if (pending) await pending; }
          finally { await closePool(c); }
        }
      }
    });
    await check("a stale real-store session stays failed closed while a new session can resume", async () => {
      const cp = initial("live-stale-session"); await storeA.create(cp);
      const s1 = new Session(storeA, cp.missionId); const s2 = new Session(storeB, cp.missionId);
      assert.ok((await s1.resume(null)).ok); assert.ok((await s2.resume(null)).ok);
      const next = revised(cp, { loopBudget: { ...cp.loopBudget, remainingTicks: 95 } });
      assert.ok((await s1.advance(next, null)).ok);
      const conflict = await s2.advance(revised(cp), null);
      assert.equal(conflict.ok, false); assert.equal(conflict.reasonCode, "checkpoint-version-conflict");
      assert.equal((await s2.resume(null)).reasonCode, "session-failed-closed");
      const fresh = await new Session(storeB, cp.missionId).resume(null);
      assert.ok(fresh.ok); assert.deepEqual(fresh.checkpoint, next);
    });
    await check("invalid budget refill threshold change time regression and cursor skip never overwrite", async () => {
      const cp = initial("live-refusals"); await storeA.create(cp);
      const current = revised(cp, { loopBudget: { ...cp.loopBudget, remainingTicks: 90 } });
      await storeA.compareAndSet(cp.missionId, 1, current, null, null);
      const bad = [revised(current, { loopBudget: cp.loopBudget }), revised(current, { savedAt: 999 }),
        revised(current, { cursor: cursorAt(cp.missionId, "PLAN") }),
        revised(current, { gateStates: current.gateStates.map((g, i) => i ? g : { ...g, maxLivelockThreshold: 4 }) })];
      for (const next of bad) {
        await assert.rejects(storeB.compareAndSet(cp.missionId, 2, next, null, null), /INVALID_RECOVERY_/);
        assert.deepEqual(await storeA.load(cp.missionId, null), current);
      }
    });
    await check("post-UPDATE receipt failure rolls back the actual SQL write", async () => {
      const cp = initial("live-update-rollback"); await storeA.create(cp);
      const badDb = new BadReceiptDatabase(dbB, "UPDATE");
      await assert.rejects(new Store(badDb).compareAndSet(cp.missionId, 1, revised(cp), null, null), /PG_RECOVERY_WRITE_RECEIPT_MISMATCH/);
      assert.equal(badDb.injected, true); assert.deepEqual(await storeA.load(cp.missionId, null), cp);
    });
    await check("post-INSERT receipt failure rolls back creation instead of leaving a hidden row", async () => {
      const cp = initial("live-insert-rollback"); const badDb = new BadReceiptDatabase(dbB, "INSERT");
      await assert.rejects(new Store(badDb).create(cp), /PG_RECOVERY_WRITE_RECEIPT_MISMATCH/);
      assert.equal(badDb.injected, true); assert.equal(await storeA.load(cp.missionId, null), null);
    });
    await check("missing mission CAS does not implicitly create a record", async () => {
      const cp = initial("live-missing");
      assert.deepEqual(await storeA.compareAndSet(cp.missionId, 1, revised(cp), null, null), { status: "NOT_FOUND" });
      assert.equal(await storeB.load(cp.missionId, null), null);
    });
    await check("frozen raw contract bytes survive JSONB and require the independent pin", async () => {
      const cp = initial("live-contract-pin"); await storeA.create(cp); let current = cp;
      const contract = frozen(cp.missionId);
      // Adjacent STORAGE fixtures only. No PLAN_TEST/PRO implementation is called.
      const pro = CANONICAL_PIPELINE_SEQUENCE.findIndex((n) => n.id === "PRO");
      for (let index = 1; index <= pro; index += 1) {
        const next = revised(current, { cursor: cursorAt(cp.missionId, CANONICAL_PIPELINE_SEQUENCE[index].id),
          frozenContract: index === pro ? contract.binding : null });
        await storeA.compareAndSet(cp.missionId, current.checkpointVersion, next, null, index === pro ? contract.pin : null);
        current = next;
      }
      const loaded = await storeB.load(cp.missionId, contract.pin);
      assert.deepEqual(loaded, current);
      assert.equal(loaded?.frozenContract?.rawContractJson, contract.binding.rawContractJson);
      await assert.rejects(storeB.load(cp.missionId, null), /INVALID_RECOVERY_CHECKPOINT/);
      await assert.rejects(storeB.load(cp.missionId, { ...contract.pin, contractHash: "0".repeat(64) }), /INVALID_RECOVERY_CHECKPOINT/);
      assert.deepEqual(await storeB.load(cp.missionId, contract.pin), current);
    });
    await check("committed budget and gate history survive forced termination of the owned Node writer", async () => {
      const cp = initial("live-owned-process-loss");
      const gate = revised(cp, { cursor: cursorAt(cp.missionId, "LOOP_AFTER_EER") });
      const failed = revised(gate, { failureCount: 1,
        loopBudget: { ...cp.loopBudget, remainingTicks: 89, remainingProviderCalls: 8, remainingFixAttempts: 2 },
        gateStates: gate.gateStates.map((g, i) => i ? g : { ...g, livelockCounter: 1 }) });
      const committed = await childResult({ schema, missionId: cp.missionId, action: "commit", initial: cp, updates: [gate, failed] }, true);
      assert.deepEqual(committed, failed);
      const restored = await childResult({ schema, missionId: cp.missionId, action: "resume" }, false);
      assert.deepEqual(restored, failed);
      assert.deepEqual(await storeB.load(cp.missionId, null), failed);
    });
    must(completed === 13, "10E6_LIVE_PROOF_CHECK_COUNT_MISMATCH");
    await verifyTarget(admin, target);
    console.log("10E6_REAL_PG_RECOVERY_CHECKS=13_PASS");
    console.log("POSTGRES_SERVER_RESTART_TEST=NOT_RUN");
    console.log("FACTORY_EXECUTION_AND_ORCHESTRATOR_REPLAY=NOT_RUN");
  } catch (error) { throw diagnostic(error); }
  finally {
    const results = await within(Promise.allSettled([...pools].map((pool) => pool.end())), 15_000, "10E6_POOL_CLEANUP_TIMEOUT");
    if (created) console.log("TEST_SCHEMA_RETAINED=" + schema);
    if (results.some((r) => r.status === "rejected")) throw new Error("10E6_POOL_CLEANUP_FAILED_SCHEMA_RETAINED");
  }
});
