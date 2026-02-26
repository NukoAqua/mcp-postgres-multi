import { describe, expect, it } from "vitest";

import { generateTransactionId, isReadOnlyQuery } from "../../src/lib/utils.js";

describe("isReadOnlyQuery", () => {
  it("accepts read-only statements", () => {
    expect(isReadOnlyQuery("SELECT 1")).toBe(true);
    expect(isReadOnlyQuery(" with x as (select 1) select * from x")).toBe(true);
    expect(isReadOnlyQuery("EXPLAIN SELECT 1")).toBe(true);
    expect(isReadOnlyQuery("SHOW search_path")).toBe(true);
  });

  it("rejects mutating statements", () => {
    expect(isReadOnlyQuery("INSERT INTO x VALUES (1)")).toBe(false);
    expect(isReadOnlyQuery("UPDATE x SET y = 1")).toBe(false);
    expect(isReadOnlyQuery("DELETE FROM x")).toBe(false);
  });
});

describe("generateTransactionId", () => {
  it("creates unique tx-prefixed ids", () => {
    const tx1 = generateTransactionId();
    const tx2 = generateTransactionId();

    expect(tx1.startsWith("tx_")).toBe(true);
    expect(tx2.startsWith("tx_")).toBe(true);
    expect(tx1).not.toBe(tx2);
  });
});
