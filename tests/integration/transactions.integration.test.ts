import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { handleExecuteCommit, handleExecuteDML, handleExecuteQuery } from "../../src/lib/tool-handlers.js";
import { TransactionManager } from "../../src/lib/transaction-manager.js";
import { getDbConnections, resetTestTable, waitForDatabase } from "../helpers/db.js";

const { directUri, bouncerUri } = getDbConnections();

const directPool = new pg.Pool({ connectionString: directUri, max: 6 });
const bouncerPool = new pg.Pool({ connectionString: bouncerUri, max: 6 });

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
])("transaction flow: %s", (_mode, pool) => {
  it("dml + commit persists changes", async () => {
    await resetTestTable(directPool);

    const manager = new TransactionManager(15000, 1000, false);

    const dmlResult = await handleExecuteDML(
      pool,
      manager,
      "INSERT INTO test_items(name) VALUES ('alpha')",
      15000,
      "app"
    );

    expect(dmlResult.isError).toBe(false);
    const txInfo = JSON.parse(dmlResult.content[0].text.split("\n\n")[0]);

    const commitResult = await handleExecuteCommit(manager, txInfo.transaction_id);
    expect(commitResult.isError).toBe(false);

    const queryResult = await handleExecuteQuery(directPool, "SELECT COUNT(*)::int AS count FROM test_items");
    const parsed = JSON.parse(queryResult.content[0].text);
    expect(parsed.rows[0].count).toBe(1);
  });

  it("cleanupTransactions rolls back uncommitted changes", async () => {
    await resetTestTable(directPool);

    const manager = new TransactionManager(15000, 1000, false);

    const dmlResult = await handleExecuteDML(
      pool,
      manager,
      "INSERT INTO test_items(name) VALUES ('beta')",
      15000,
      "app"
    );
    expect(dmlResult.isError).toBe(false);

    await manager.cleanupTransactions();

    const queryResult = await handleExecuteQuery(directPool, "SELECT COUNT(*)::int AS count FROM test_items");
    const parsed = JSON.parse(queryResult.content[0].text);
    expect(parsed.rows[0].count).toBe(0);
  });

  it("timeout monitor auto-rolls back stale transactions", async () => {
    await resetTestTable(directPool);

    const manager = new TransactionManager(150, 50, true);
    manager.startMonitor();

    const dmlResult = await handleExecuteDML(
      pool,
      manager,
      "INSERT INTO test_items(name) VALUES ('gamma')",
      150,
      "app"
    );
    expect(dmlResult.isError).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const queryResult = await handleExecuteQuery(directPool, "SELECT COUNT(*)::int AS count FROM test_items");
    const parsed = JSON.parse(queryResult.content[0].text);

    expect(parsed.rows[0].count).toBe(0);
    expect(manager.transactionCount).toBe(0);

    manager.stopMonitor();
  });
});
