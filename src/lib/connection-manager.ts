import pg from "pg";
import config from "./config.js";

function maskUri(uri: string): string {
  try {
    const u = new URL(uri);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return uri.replace(/:[^:@]+@/, ':***@');
  }
}

function extractDbName(uri: string): string {
  try {
    const u = new URL(uri);
    const segments = u.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] || 'default';
  } catch (err) {
    console.error(`Warning: Failed to parse database name from URI, using "default":`, err);
    return 'default';
  }
}

export class ConnectionManager {
  private pools: Map<string, pg.Pool> = new Map();
  private uris: Map<string, string> = new Map();

  constructor(uriList: string[]) {
    if (uriList.length === 0) {
      throw new Error('At least one database URI is required');
    }

    // First pass: extract base names
    const baseNames = uriList.map(uri => extractDbName(uri));

    // Second pass: generate unique aliases
    const usedAliases = new Set<string>();

    for (let i = 0; i < uriList.length; i++) {
      const uri = uriList[i];
      const baseName = baseNames[i];

      let alias = baseName;
      let suffix = 1;
      while (usedAliases.has(alias)) {
        alias = `${baseName}_${suffix}`;
        suffix++;
      }
      usedAliases.add(alias);

      const pool = new pg.Pool({
        connectionString: uri,
        max: config.pg.maxConnections,
        idleTimeoutMillis: config.pg.idleTimeoutMillis,
        connectionTimeoutMillis: 5000,
      });

      pool.on('error', (err) => {
        console.error(`Pool "${alias}" background error:`, err.message);
      });

      this.pools.set(alias, pool);
      this.uris.set(alias, uri);
    }
  }

  getPool(alias: string): pg.Pool {
    const pool = this.pools.get(alias);
    if (!pool) {
      throw new Error(`Unknown database alias: "${alias}". Available: ${this.getAliases().join(', ')}`);
    }
    return pool;
  }

  getAliases(): string[] {
    return Array.from(this.pools.keys());
  }

  getAllDatabases(): Array<{ alias: string; displayUri: string }> {
    return this.getAliases().map(alias => ({
      alias,
      displayUri: maskUri(this.uris.get(alias)!),
    }));
  }

  async testConnections(): Promise<void> {
    const failures: Array<{ alias: string; error: string }> = [];
    for (const [alias, pool] of this.pools) {
      try {
        const client = await pool.connect();
        try {
          await client.query('SELECT 1');
        } finally {
          client.release();
        }
        console.error(`Connected to database: ${alias} (${maskUri(this.uris.get(alias)!)})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Failed to connect to database: ${alias} (${maskUri(this.uris.get(alias)!)}): ${msg}`);
        failures.push({ alias, error: msg });
      }
    }
    if (failures.length > 0) {
      throw new Error(`Failed to connect to ${failures.length} database(s): ${failures.map(f => `${f.alias} (${f.error})`).join(', ')}`);
    }
  }

  async shutdown(): Promise<void> {
    const errors: Array<{ alias: string; error: unknown }> = [];
    for (const [alias, pool] of this.pools) {
      try {
        await pool.end();
        console.error(`Pool closed: ${alias}`);
      } catch (err) {
        console.error(`Error closing pool "${alias}":`, err);
        errors.push({ alias, error: err });
      }
    }
    this.pools.clear();
    this.uris.clear();
    if (errors.length > 0) {
      console.error(`Failed to close ${errors.length} pool(s)`);
    }
  }
}
