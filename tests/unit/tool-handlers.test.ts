import { describe, expect, it, vi } from "vitest";

import {
  handleDescribeTable,
  handleExecuteCommit,
  handleExecuteDML,
  handleExecuteMaintenance,
  handleExecuteQuery,
  handleListTables,
} from "../../src/lib/tool-handlers.js";
import { TransactionManager } from "../../src/lib/transaction-manager.js";

type QueryResult = {
  rows?: unknown[];
  rowCount?: number;
  fields?: Array<{ name: string; dataTypeID: number }>;
  command?: string;
};

function makePoolWithClient(queryImpl: (sql: string) => Promise<QueryResult>) {
  const client = {
    query: vi.fn((sql: string) => queryImpl(sql)),
    release: vi.fn(),
  };

  return {
    pool: {
      connect: vi.fn().mockResolvedValue(client),
    } as never,
    client,
  };
}

describe("tool-handlers unit", () => {
  it("execute_query rejects non-read-only SQL", async () => {
    const { pool } = makePoolWithClient(async () => ({ rows: [] }));

    const result = await handleExecuteQuery(pool, "DELETE FROM t");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Only SELECT queries are allowed");
  });

  it("execute_query rolls back on query error", async () => {
    const { pool, client } = makePoolWithClient(async (sql) => {
      if (sql === "BEGIN TRANSACTION READ ONLY") return {};
      if (sql === "ROLLBACK") return {};
      throw new Error("boom");
    });

    await expect(handleExecuteQuery(pool, "SELECT * FROM missing_table")).rejects.toThrow("boom");
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("execute_dml starts transaction and stores pending tx", async () => {
    const { pool, client } = makePoolWithClient(async (sql) => {
      if (sql === "BEGIN") return {};
      return { command: "INSERT", rowCount: 1 };
    });

    const manager = new TransactionManager();
    const result = await handleExecuteDML(pool, manager, "INSERT INTO t VALUES (1)", 15000, "app");

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("transaction_id");
    expect(manager.transactionCount).toBe(1);
    expect(client.release).not.toHaveBeenCalled();
  });

  it("execute_maintenance rejects unsupported SQL", async () => {
    const { pool } = makePoolWithClient(async () => ({ command: "VACUUM" }));

    const result = await handleExecuteMaintenance(pool, "SELECT 1");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Only VACUUM, ANALYZE and CREATE DATABASE");
  });

  it("execute_commit commits and cleans transaction", async () => {
    const manager = new TransactionManager();
    const client = { query: vi.fn().mockResolvedValue({}), release: vi.fn() };
    manager.addTransaction("tx_ok", client as never, "UPDATE t SET x=1", "app");

    const result = await handleExecuteCommit(manager, "tx_ok");

    expect(result.isError).toBe(false);
    expect(client.query).toHaveBeenCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(manager.hasTransaction("tx_ok")).toBe(false);
  });

  it("execute_commit rolls back on commit failure", async () => {
    const manager = new TransactionManager();
    const client = {
      query: vi
        .fn()
        .mockRejectedValueOnce(new Error("commit failed"))
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    manager.addTransaction("tx_fail", client as never, "UPDATE t SET x=1", "app");

    const result = await handleExecuteCommit(manager, "tx_fail");

    expect(result.isError).toBe(true);
    expect(client.query).toHaveBeenNthCalledWith(1, "COMMIT");
    expect(client.query).toHaveBeenNthCalledWith(2, "ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(manager.hasTransaction("tx_fail")).toBe(false);
  });

  it("list_tables and describe_table return non-error payloads", async () => {
    const calls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        if (sql.includes("information_schema.tables")) return { rows: [{ table_name: "test_items" }] };
        if (sql.includes("information_schema.columns")) return { rows: [{ column_name: "id" }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as never;

    const listResult = await handleListTables(pool, "public");
    const descResult = await handleDescribeTable(pool, "test_items", "public");

    expect(listResult.isError).toBe(false);
    expect(descResult.isError).toBe(false);
    expect(calls.some((c) => c.includes("information_schema.tables"))).toBe(true);
    expect(calls.some((c) => c.includes("information_schema.columns"))).toBe(true);
  });
});
