import pg from "pg";

export interface DbConnections {
  directUri: string;
  bouncerUri: string;
}

export function getDbConnections(): DbConnections {
  const directUri = process.env.TEST_PG_URI_DIRECT ?? "postgresql://postgres:postgres@127.0.0.1:5432/app";
  const bouncerUri = process.env.TEST_PG_URI_BOUNCER ?? "postgresql://postgres:postgres@127.0.0.1:6432/app";
  return { directUri, bouncerUri };
}

export async function waitForDatabase(uri: string, timeoutMs = 20000): Promise<void> {
  const started = Date.now();
  let lastError: unknown;

  while (Date.now() - started < timeoutMs) {
    const pool = new pg.Pool({ connectionString: uri, max: 1 });
    try {
      const client = await pool.connect();
      try {
        await client.query("SELECT 1");
        return;
      } finally {
        client.release();
      }
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      await pool.end();
    }
  }

  throw new Error(`Database not ready for URI ${uri}. Last error: ${String(lastError)}`);
}

export async function resetTestTable(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS test_items (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL
      )
    `);
    await client.query("TRUNCATE TABLE test_items RESTART IDENTITY");
  } finally {
    client.release();
  }
}
