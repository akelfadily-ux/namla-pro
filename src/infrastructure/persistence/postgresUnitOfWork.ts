import { StateRepository } from "../../domain/contracts";
import { UnitOfWork } from "../../domain/unit-of-work";
import { ConfigurationError } from "../../domain/errors";

export interface PgPoolLike {
  connect(): Promise<PgClientLike>;
}

export interface PgClientLike {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount?: number }>;
  release(): void;
}

export class PostgresUnitOfWork implements UnitOfWork {
  constructor(private readonly pool: PgPoolLike) {
    if (!pool || typeof pool.connect !== "function") {
      throw new ConfigurationError("PostgresUnitOfWork requires a valid PostgreSQL pool instance");
    }
  }

  async transaction<T>(fn: (state: StateRepository) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { PostgresStateRepository } = await import("./postgresStateRepository");
      const txRepo = new PostgresStateRepository(client);
      const result = await fn(txRepo);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      if (typeof client.release === "function") {
        client.release();
      }
    }
  }
}
