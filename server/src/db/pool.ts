import pg from 'pg';
import { env } from '../config/env';

/**
 * A single shared connection pool for the whole app.
 * Every query in the project goes through `query()` or `withTransaction()`.
 */
export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

// PostgreSQL returns NUMERIC columns as strings (to avoid precision loss).
// Our numeric values (scores, confidence) are small, so parse them as numbers.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => parseFloat(value));

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

/**
 * Runs several queries as one all-or-nothing unit.
 * If anything inside throws, every change is rolled back.
 */
export async function withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
