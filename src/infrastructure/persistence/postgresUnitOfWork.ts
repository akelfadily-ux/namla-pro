import { StateRepository } from "../../domain/contracts";

export interface UnitOfWork {
  transaction<T>(
    fn: (state: StateRepository) => Promise<T>,
  ): Promise<T>;
}

export class PostgresUnitOfWork implements UnitOfWork {
  constructor(private readonly repository: StateRepository, private readonly poolOrClient?: any) {}

  async transaction<T>(fn: (state: StateRepository) => Promise<T>): Promise<T> {
    if (this.poolOrClient && typeof this.poolOrClient.connect === "function") {
      const client = await this.poolOrClient.connect();
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
        if (typeof client.release === "function") client.release();
      }
    } else if (this.poolOrClient && typeof this.poolOrClient.query === "function") {
      await this.poolOrClient.query("BEGIN");
      try {
        const result = await fn(this.repository);
        await this.poolOrClient.query("COMMIT");
        return result;
      } catch (error) {
        await this.poolOrClient.query("ROLLBACK");
        throw error;
      }
    }
    if (this.repository) {
      return fn(this.repository);
    }
    throw new Error("UnitOfWork requires a valid PostgreSQL database connection/pool to execute transactions");
  }
}
