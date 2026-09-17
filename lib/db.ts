import { Pool, QueryResultRow } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __adBrainPool: Pool | undefined;
}

function makePool() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) {
    return new Pool({
      connectionString,
      max: Number(process.env.DB_POOL_MAX || 10),
      ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
    });
  }

  const host = process.env.DB_HOST?.trim();
  const database = process.env.DB_NAME?.trim();
  const user = process.env.DB_USER?.trim();
  if (!host || !database || !user) return null;

  return new Pool({
    host,
    port: Number(process.env.DB_PORT || 5432),
    database,
    user,
    password: process.env.DB_PASSWORD || "",
    max: Number(process.env.DB_POOL_MAX || 10),
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  });
}

export function getDb() {
  if (!globalThis.__adBrainPool) {
    const pool = makePool();
    if (!pool) return null;
    globalThis.__adBrainPool = pool;
  }
  return globalThis.__adBrainPool;
}

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL || (process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER));
}

export async function query<T extends QueryResultRow = any>(text: string, params: unknown[] = []) {
  const db = getDb();
  if (!db) throw new Error("Local PostgreSQL is not configured. Add DB_HOST, DB_NAME, DB_USER and DB_PASSWORD to .env.local.");
  return db.query<T>(text, params);
}

export async function withTransaction<T>(fn: (client: any) => Promise<T>) {
  const db = getDb();
  if (!db) throw new Error("Local PostgreSQL is not configured.");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
