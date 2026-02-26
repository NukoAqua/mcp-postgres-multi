#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import config from "./lib/config.js";
import { ConnectionManager } from "./lib/connection-manager.js";
import { TransactionManager } from "./lib/transaction-manager.js";
import { safelyReleaseClient } from "./lib/utils.js";
import {
  handleExecuteQuery,
  handleExecuteDML,
  handleExecuteCommit,
  handleExecuteMaintenance,
  handleListTables,
  handleDescribeTable,
} from "./lib/tool-handlers.js";
import { withToolTracking, registerToolHelp } from "./lib/tool-help.js";

// Parse CLI args - multiple URIs
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: mcp-postgres-multi <pg_uri_1> [pg_uri_2] ...");
  process.exit(1);
}

// Create connection manager with all URIs
const connectionManager = new ConnectionManager(args);

// Create transaction manager
const transactionManager = new TransactionManager(
  config.transactionTimeoutMs,
  config.monitorIntervalMs,
  config.enableTransactionMonitor
);

// Create MCP server with tool tracking
let server = new McpServer(
  { name: "mcp-postgres-multi", version: "1.0.0" },
  { capabilities: { tools: {} } }
);
server = withToolTracking(server);

// Helper to transform handler responses
function transformHandlerResponse(result: any) {
  if (!result) return result;
  const transformedResult = { ...result };
  if (result.content) {
    transformedResult.content = result.content.map((item: any) => {
      if (item.type === "text") return { type: "text" as const, text: item.text };
      return item;
    });
  }
  return transformedResult;
}

// Helper to resolve database alias to pool
function resolvePool(database: string) {
  try {
    return connectionManager.getPool(database);
  } catch (err) {
    const aliases = connectionManager.getAliases();
    throw new Error(
      `Unknown database alias "${database}". Available databases: ${aliases.join(", ")}. ` +
      `Call available_databases to see all aliases.` +
      (err instanceof Error ? ` (${err.message})` : '')
    );
  }
}

// ── Tool: available_databases ──────────────────────────────────────

server.tool(
  "available_databases",
  "List all configured database aliases and their connection URIs (passwords redacted). Call this first to discover available database aliases.",
  {},
  async () => {
    const databases = connectionManager.getAllDatabases();
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ databases, total: databases.length }, null, 2),
      }],
      isError: false,
    };
  }
);

// ── Tool: execute_query ────────────────────────────────────────────

server.tool(
  "execute_query",
  "Run a read-only SQL query (SELECT statements) on a specified database.",
  {
    database: z.string().describe("Database alias (from available_databases)"),
    sql: z.string().describe("SQL query to execute (SELECT only)"),
  },
  async (args) => {
    try {
      const pool = resolvePool(args.database);
      const result = await handleExecuteQuery(pool, args.sql);
      return transformHandlerResponse(result);
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

// ── Tool: execute_dml_ddl_dcl_tcl ──────────────────────────────────

server.tool(
  "execute_dml_ddl_dcl_tcl",
  "Execute DML, DDL, DCL, or TCL statements (INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, etc) on a specified database. Automatically wrapped in a transaction requiring explicit commit or rollback.",
  {
    database: z.string().describe("Database alias (from available_databases)"),
    sql: z.string().describe("SQL statement to execute"),
  },
  async (args) => {
    try {
      if (transactionManager.transactionCount >= config.maxConcurrentTransactions) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: "error",
              message: `Maximum concurrent transactions limit reached (${config.maxConcurrentTransactions}). Try again later.`,
            }, null, 2),
          }],
          isError: true,
        };
      }
      const pool = resolvePool(args.database);
      const result = await handleExecuteDML(pool, transactionManager, args.sql, config.transactionTimeoutMs, args.database);
      return transformHandlerResponse(result);
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

// ── Tool: execute_maintenance ──────────────────────────────────────

server.tool(
  "execute_maintenance",
  "Execute maintenance commands like VACUUM, ANALYZE, or CREATE DATABASE outside of transactions.",
  {
    database: z.string().describe("Database alias (from available_databases)"),
    sql: z.string().describe("SQL statement (VACUUM, ANALYZE, or CREATE DATABASE)"),
  },
  async (args) => {
    try {
      const pool = resolvePool(args.database);
      const result = await handleExecuteMaintenance(pool, args.sql);
      return transformHandlerResponse(result);
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

// ── Tool: execute_commit ───────────────────────────────────────────

server.tool(
  "execute_commit",
  "Commit a transaction by its ID to permanently apply the changes.",
  {
    transaction_id: z.string().describe("ID of the transaction to commit"),
  },
  async (args) => {
    try {
      const result = await handleExecuteCommit(transactionManager, args.transaction_id);
      return transformHandlerResponse(result);
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

// ── Tool: execute_rollback ─────────────────────────────────────────

server.tool(
  "execute_rollback",
  "Rollback a transaction by its ID to undo all changes.",
  {
    transaction_id: z.string().describe("ID of the transaction to rollback"),
  },
  async (args) => {
    try {
      const transactionId = args.transaction_id;
      const transaction = transactionManager.getTransaction(transactionId);
      if (!transaction) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ status: "error", message: "Transaction not found or already rolled back", transaction_id: transactionId }, null, 2),
          }],
          isError: true,
        };
      }
      if (transaction.released) {
        transactionManager.removeTransaction(transactionId);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ status: "error", message: "Transaction client already released", transaction_id: transactionId }, null, 2),
          }],
          isError: true,
        };
      }
      try {
        await transaction.client.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error(`ROLLBACK query failed for transaction ${transactionId}:`, rollbackErr);
      } finally {
        transaction.released = true;
        safelyReleaseClient(transaction.client);
        transactionManager.removeTransaction(transactionId);
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ status: "rolled_back", message: "Transaction successfully rolled back", transaction_id: transactionId, database: transaction.database }, null, 2),
        }],
        isError: false,
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

// ── Tool: list_tables ──────────────────────────────────────────────

server.tool(
  "list_tables",
  "Get a list of all tables in a database schema.",
  {
    database: z.string().describe("Database alias (from available_databases)"),
    schema_name: z.string().describe("Schema name").default("public"),
  },
  async (args) => {
    try {
      const pool = resolvePool(args.database);
      const result = await handleListTables(pool, args.schema_name);
      return transformHandlerResponse(result);
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

// ── Tool: describe_table ───────────────────────────────────────────

server.tool(
  "describe_table",
  "Get detailed information about a specific table, including columns, primary keys, foreign keys, and indexes.",
  {
    database: z.string().describe("Database alias (from available_databases)"),
    table_name: z.string().describe("Name of the table to describe"),
    schema_name: z.string().describe("Schema name").default("public"),
  },
  async (args) => {
    try {
      const pool = resolvePool(args.database);
      const result = await handleDescribeTable(pool, args.table_name, args.schema_name);
      return transformHandlerResponse(result);
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

// ── Register tool_help (must be last) ──────────────────────────────

registerToolHelp(server);

// ── Server startup ─────────────────────────────────────────────────

async function runServer() {
  const databases = connectionManager.getAllDatabases();
  console.error(`Starting mcp-postgres-multi with ${databases.length} database(s):`);
  for (const db of databases) {
    console.error(`  - ${db.alias}: ${db.displayUri}`);
  }
  console.error(`Configuration:
- Transaction timeout: ${config.transactionTimeoutMs}ms
- Monitor interval: ${config.monitorIntervalMs}ms
- Transaction monitor enabled: ${config.enableTransactionMonitor}
- Max concurrent transactions: ${config.maxConcurrentTransactions}
- Max DB connections per pool: ${config.pg.maxConnections}
`);

  try {
    await connectionManager.testConnections();
    console.error("All database connections verified");

    transactionManager.startMonitor();

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCP server started and ready to accept connections");
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Error handling
process.on("unhandledRejection", async (reason) => {
  console.error("Unhandled promise rejection:", reason);
  try {
    transactionManager.stopMonitor();
    await transactionManager.cleanupTransactions();
    await connectionManager.shutdown();
  } catch (err) {
    console.error("Error during emergency cleanup:", err);
  }
  process.exit(1);
});

process.on("SIGINT", async () => {
  console.error("Shutting down...");
  try {
    transactionManager.stopMonitor();
    await transactionManager.cleanupTransactions();
    await connectionManager.shutdown();
    console.error("All database pools closed");
  } catch (err) {
    console.error("Error during shutdown:", err);
  }
  process.exit(0);
});

process.on("uncaughtException", async (error) => {
  console.error("Uncaught exception:", error);
  try {
    transactionManager.stopMonitor();
    await transactionManager.cleanupTransactions();
    await connectionManager.shutdown();
  } catch (err) {
    console.error("Error during emergency cleanup:", err);
  }
  process.exit(1);
});

runServer().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
