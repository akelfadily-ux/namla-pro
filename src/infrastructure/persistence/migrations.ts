import { readFileSync } from "fs";
import { join } from "path";

export interface PostgresQueryClient {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount?: number }>;
}

export class MigrationRunner {
  constructor(private readonly client: PostgresQueryClient) {}

  async runMigrations(): Promise<void> {
    let sqlPath = join(__dirname, "migrations", "001_initial_schema.sql");
    const { existsSync } = await import("fs");
    if (!existsSync(sqlPath)) {
      sqlPath = join(process.cwd(), "src", "infrastructure", "persistence", "migrations", "001_initial_schema.sql");
    }
    const migrationSql = readFileSync(sqlPath, "utf8");

    await this.client.query("BEGIN");
    try {
      await this.client.query(migrationSql);
      await this.client.query(
        "INSERT INTO schema_migrations (version, name) VALUES (1, '001_initial_schema') ON CONFLICT (version) DO NOTHING",
      );
      await this.client.query("COMMIT");
    } catch (error) {
      await this.client.query("ROLLBACK");
      throw error;
    }
  }
}
