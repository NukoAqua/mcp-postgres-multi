import { beforeEach, describe, expect, it, vi } from "vitest";

const poolInstances: Array<{ end: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }> = [];

vi.mock("pg", () => {
  class Pool {
    connect = vi.fn();
    end = vi.fn().mockResolvedValue(undefined);
    on = vi.fn();
    constructor() {
      poolInstances.push(this as unknown as { end: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> });
    }
  }

  return {
    default: { Pool },
  };
});

describe("ConnectionManager", () => {
  beforeEach(() => {
    poolInstances.length = 0;
  });

  it("derives unique aliases from db names", async () => {
    const { ConnectionManager } = await import("../../src/lib/connection-manager.js");
    const manager = new ConnectionManager([
      "postgresql://u:p@localhost:5432/app",
      "postgresql://u:p@localhost:5432/app",
      "postgresql://u:p@localhost:5432/log",
    ]);

    expect(manager.getAliases()).toEqual(["app", "app_1", "log"]);
  });

  it("masks passwords in getAllDatabases", async () => {
    const { ConnectionManager } = await import("../../src/lib/connection-manager.js");
    const manager = new ConnectionManager(["postgresql://user:secret@localhost:5432/app"]);

    const databases = manager.getAllDatabases();
    expect(databases[0].displayUri).toContain(":***@");
    expect(databases[0].displayUri).not.toContain("secret");
  });

  it("throws on unknown alias", async () => {
    const { ConnectionManager } = await import("../../src/lib/connection-manager.js");
    const manager = new ConnectionManager(["postgresql://u:p@localhost:5432/app"]);

    expect(() => manager.getPool("missing")).toThrow(/Unknown database alias/);
  });

  it("closes all pools on shutdown", async () => {
    const { ConnectionManager } = await import("../../src/lib/connection-manager.js");
    const manager = new ConnectionManager([
      "postgresql://u:p@localhost:5432/app",
      "postgresql://u:p@localhost:5432/log",
    ]);

    await manager.shutdown();

    expect(poolInstances).toHaveLength(2);
    for (const pool of poolInstances) {
      expect(pool.end).toHaveBeenCalledTimes(1);
    }
  });
});
