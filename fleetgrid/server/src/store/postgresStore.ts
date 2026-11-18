import { Pool, type PoolClient } from 'pg';
import type { Store } from './jsonStore.js';

const TABLE = 'fleetgrid_records';

export interface PostgresStoreOptions {
  collection: string;
}

/**
 * PostgreSQL-backed implementation of the existing Store interface.
 * Collections share one namespaced JSONB table so existing domain records can
 * move to persistent storage without rewriting every service at once.
 */
export function createPostgresStore<T extends { id: string }>(
  pool: Pool,
  options: PostgresStoreOptions,
): Store<T> {
  const collection = options.collection;

  async function rows(client: Pool | PoolClient): Promise<T[]> {
    const result = await client.query(
      `SELECT data FROM ${TABLE} WHERE collection = $1 ORDER BY created_at, id`,
      [collection],
    );
    return result.rows.map((row) => row.data as T);
  }

  return {
    async get() {
      return rows(pool);
    },
    async find(predicate) {
      return (await rows(pool)).filter(predicate);
    },
    async findById(id) {
      const result = await pool.query(
        `SELECT data FROM ${TABLE} WHERE collection = $1 AND id = $2 LIMIT 1`,
        [collection, id],
      );
      return result.rows[0]?.data as T | undefined;
    },
    async create(row) {
      try {
        await pool.query(
          `INSERT INTO ${TABLE} (collection, id, data) VALUES ($1, $2, $3::jsonb)`,
          [collection, row.id, JSON.stringify(row)],
        );
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new Error(`[store:${collection}] duplicate id ${row.id}`);
        }
        throw error;
      }
      return row;
    },
    async update(id, patch) {
      const result = await pool.query(
        `UPDATE ${TABLE}
         SET data = data || $3::jsonb
         WHERE collection = $1 AND id = $2
         RETURNING data`,
        [collection, id, JSON.stringify({ ...patch, id })],
      );
      return result.rows[0]?.data as T | undefined;
    },
    async delete(id) {
      const result = await pool.query(
        `DELETE FROM ${TABLE} WHERE collection = $1 AND id = $2`,
        [collection, id],
      );
      return (result.rowCount ?? 0) > 0;
    },
    async clear() {
      await pool.query(`DELETE FROM ${TABLE} WHERE collection = $1`, [collection]);
    },
    async replaceAll(items) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM ${TABLE} WHERE collection = $1`, [collection]);
        for (const item of items) {
          await client.query(
            `INSERT INTO ${TABLE} (collection, id, data) VALUES ($1, $2, $3::jsonb)`,
            [collection, item.id, JSON.stringify(item)],
          );
        }
        await client.query('COMMIT');
        return [...items];
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export async function initializePostgres(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (collection, id)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS fleetgrid_records_collection_idx ON ${TABLE} (collection)`,
  );
  // Enforce unique, case-insensitive email addresses for credential accounts.
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS fleetgrid_auth_email_unique_idx
     ON ${TABLE} (LOWER(data->>'email'))
     WHERE collection = 'auth-accounts'`,
  );
}
