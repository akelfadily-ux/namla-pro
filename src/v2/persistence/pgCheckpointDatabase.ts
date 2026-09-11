import {
  Pool,
  PoolClient,
} from "pg";

import {
  PostgresCheckpointClient,
  PostgresCheckpointDatabase,
  PostgresCheckpointQueryResult,
} from "./postgresMissionCheckpointStore";

export class PostgresTransactionRollbackError
  extends Error
{
  public readonly transactionError: unknown;
  public readonly rollbackError: unknown;

  public constructor(
    transactionError: unknown,
    rollbackError: unknown,
  ) {
    super("POSTGRES_TRANSACTION_ROLLBACK_FAILED");

    this.name =
      "PostgresTransactionRollbackError";

    this.transactionError =
      transactionError;

    this.rollbackError =
      rollbackError;
  }
}

function valuesFrom(
  params?: readonly unknown[],
): unknown[] | undefined {
  if (!params) {
    return undefined;
  }

  return [...params];
}

async function executeQuery<T>(
  executor: Pool | PoolClient,
  sql: string,
  params?: readonly unknown[],
): Promise<PostgresCheckpointQueryResult<T>> {
  const result =
    await executor.query(
      sql,
      valuesFrom(params),
    );

  return {
    rows:
      result.rows as readonly T[],
    rowCount:
      result.rowCount,
  };
}

function transactionClient(
  client: PoolClient,
): PostgresCheckpointClient {
  return {
    query: async <T = unknown>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<PostgresCheckpointQueryResult<T>> =>
      executeQuery<T>(
        client,
        sql,
        params,
      ),
  };
}

export class PgCheckpointDatabase
  implements PostgresCheckpointDatabase
{
  public constructor(
    private readonly pool: Pool,
  ) {}

  public async query<T = unknown>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<PostgresCheckpointQueryResult<T>> {
    return executeQuery<T>(
      this.pool,
      sql,
      params,
    );
  }

  public async transaction<T>(
    work: (
      client: PostgresCheckpointClient,
    ) => Promise<T>,
  ): Promise<T> {
    const client =
      await this.pool.connect();

    let transactionStarted = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;

      const result =
        await work(
          transactionClient(client),
        );

      await client.query("COMMIT");

      return result;
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          throw new PostgresTransactionRollbackError(
            error,
            rollbackError,
          );
        }
      }

      throw error;
    } finally {
      client.release();
    }
  }
}