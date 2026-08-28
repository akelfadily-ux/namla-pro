import { StateRepository } from "./contracts";

export interface UnitOfWork {
  transaction<T>(
    fn: (state: StateRepository) => Promise<T>,
  ): Promise<T>;
}

export class PostgresUnitOfWork implements UnitOfWork {
  constructor(private readonly repository: StateRepository, private readonly dbClient?: any) {}

  async transaction<T>(fn: (state: StateRepository) => Promise<T>): Promise<T> {
    if (this.dbClient && typeof this.dbClient.query === "function") {
      await this.dbClient.query("BEGIN");
      try {
        const result = await fn(this.repository);
        await this.dbClient.query("COMMIT");
        return result;
      } catch (error) {
        await this.dbClient.query("ROLLBACK");
        throw error;
      }
    }
    return fn(this.repository);
  }
}
