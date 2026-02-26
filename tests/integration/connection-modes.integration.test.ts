import pg from "pg";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { handleExecuteQuery } from "../../src/lib/tool-handlers.js";
import { getDbConnections, waitForDatabase } from "../helpers/db.js";

const { directUri, bouncerUri } = getDbConnections();

const pools: Record<string, pg.Pool> = {
  direct: new pg.Pool({ connectionString: directUri, max: 4 }),
  bouncer: new pg.Pool({ connectionString: bouncerUri, max: 4 }),
};

beforeAll(async () => {
  await waitForDatabase(directUri);
  await waitForDatabase(bouncerUri);
});

afterAll(async () => {
  await Promise.all(Object.values(pools).map((p) => p.end()));
});

describe.each([
  ["direct", pools.direct],
  ["pgbouncer", pools.bouncer],
])("connection mode: %s", (_name, pool) => {
  it("execute_query works for read-only statements", async () => {
    const result = await handleExecuteQuery(pool, "SELECT 1 AS n");
    expect(result.isError).toBe(false);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.rows[0].n).toBe(1);
  });

  it("rejects mutating statement via execute_query", async () => {
    const result = await handleExecuteQuery(pool, "INSERT INTO test_items(name) VALUES ('x')");
    expect(result.isError).toBe(true);
  });

  it("recovers after SQL error (no leaked aborted transaction)", async () => {
    await expect(handleExecuteQuery(pool, "SELECT * FROM table_that_does_not_exist")).rejects.toThrow();

    const result = await handleExecuteQuery(pool, "SELECT 42 AS ok");
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.rows[0].ok).toBe(42);
  });
});
