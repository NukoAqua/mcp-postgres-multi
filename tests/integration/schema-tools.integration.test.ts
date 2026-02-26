import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { handleDescribeTable, handleListTables } from "../../src/lib/tool-handlers.js";
import { getDbConnections, resetTestTable, waitForDatabase } from "../helpers/db.js";

const { directUri, bouncerUri } = getDbConnections();

const directPool = new pg.Pool({ connectionString: directUri, max: 3 });
const bouncerPool = new pg.Pool({ connectionString: bouncerUri, max: 3 });

beforeAll(async () => {
  await waitForDatabase(directUri);
  await waitForDatabase(bouncerUri);
  await resetTestTable(directPool);
});

afterAll(async () => {
  await Promise.all([directPool.end(), bouncerPool.end()]);
});

describe.each([
  ["direct", directPool],
  ["pgbouncer", bouncerPool],
])("schema tools via %s", (_mode, pool) => {
  it("lists tables", async () => {
    const result = await handleListTables(pool, "public");
    expect(result.isError).toBe(false);

    const rows = JSON.parse(result.content[0].text) as Array<{ table_name: string }>;
    expect(rows.some((r) => r.table_name === "test_items")).toBe(true);
  });

  it("describes a table", async () => {
    const result = await handleDescribeTable(pool, "test_items", "public");
    expect(result.isError).toBe(false);

    const payload = JSON.parse(result.content[0].text);
    expect(Array.isArray(payload.columns)).toBe(true);
    expect(payload.columns.some((c: { column_name: string }) => c.column_name === "id")).toBe(true);
  });
});
