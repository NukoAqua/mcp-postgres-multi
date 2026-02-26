import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionManager } from "../../src/lib/transaction-manager.js";

interface MockClient {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

function makeClient(): MockClient {
  return {
    query: vi.fn().mockResolvedValue({}),
    release: vi.fn(),
  };
}

describe("TransactionManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("tracks transaction add/get/remove", () => {
    const manager = new TransactionManager();
    const client = makeClient();

    manager.addTransaction("tx_1", client as never, "INSERT INTO t VALUES (1)", "app");
    expect(manager.transactionCount).toBe(1);
    expect(manager.hasTransaction("tx_1")).toBe(true);

    const tx = manager.getTransaction("tx_1");
    expect(tx?.database).toBe("app");
    expect(tx?.state).toBe("active");

    manager.removeTransaction("tx_1");
    expect(manager.transactionCount).toBe(0);
  });

  it("rolls back timed-out transactions and releases clients", async () => {
    const manager = new TransactionManager(50, 10, true);
    const client = makeClient();
    manager.addTransaction("tx_timeout", client as never, "UPDATE test_items SET name='x'", "app");

    manager.startMonitor();
    await vi.advanceTimersByTimeAsync(120);

    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(manager.hasTransaction("tx_timeout")).toBe(false);

    manager.stopMonitor();
  });

  it("cleanupTransactions rolls back all and clears map", async () => {
    const manager = new TransactionManager();
    const c1 = makeClient();
    const c2 = makeClient();

    manager.addTransaction("tx_1", c1 as never, "UPDATE a SET b=1", "app");
    manager.addTransaction("tx_2", c2 as never, "DELETE FROM a", "app");

    await manager.cleanupTransactions();

    expect(c1.query).toHaveBeenCalledWith("ROLLBACK");
    expect(c2.query).toHaveBeenCalledWith("ROLLBACK");
    expect(c1.release).toHaveBeenCalledTimes(1);
    expect(c2.release).toHaveBeenCalledTimes(1);
    expect(manager.transactionCount).toBe(0);
  });
});
