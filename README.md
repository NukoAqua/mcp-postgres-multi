# mcp-postgres-multi

Multi-database PostgreSQL MCP server with full read-write access. Forked from [mcp-postgres-full-access](https://github.com/syahiidkamil/mcp-postgres-full-access) with multi-DB support.

## Features

- **Multiple databases**: Connect to multiple PostgreSQL databases simultaneously
- **Auto-aliasing**: Database aliases derived from URI path (e.g., `postgresql://host/mydb` -> alias `mydb`)
- **Full read-write access**: SELECT, INSERT, UPDATE, DELETE, DDL, maintenance commands
- **Transaction management**: Automatic transaction wrapping with commit/rollback
- **Self-documenting**: Built-in `tool_help` for all tools

## Installation

```bash
npm install
npm run build
```

## Usage

```bash
node dist/index.js "postgresql://user:pass@host:5432/db1" "postgresql://user:pass@host:5432/db2"
```

### Claude Code Configuration

```json
{
  "mcpServers": {
    "postgres-multi": {
      "command": "node",
      "args": [
        "/path/to/mcp-postgres-multi/dist/index.js",
        "postgresql://user:pass@host:5432/log_db",
        "postgresql://user:pass@host:5432/rag_db",
        "postgresql://user:pass@host:5432/llm_db",
        "postgresql://user:pass@host:5432/hil_db",
        "postgresql://user:pass@host:5432/evolve_db"
      ]
    }
  }
}
```

## Tools (9)

| Tool | Description |
|------|-------------|
| `available_databases` | List all configured database aliases and URIs |
| `execute_query` | Run read-only SELECT queries |
| `execute_dml_ddl_dcl_tcl` | Execute write operations (INSERT/UPDATE/DELETE/DDL) with transaction |
| `execute_maintenance` | Run VACUUM/ANALYZE/CREATE DATABASE |
| `execute_commit` | Commit a pending transaction |
| `execute_rollback` | Rollback a pending transaction |
| `list_tables` | List all tables in a schema |
| `describe_table` | Get table structure details |
| `tool_help` | Get help for any tool |

## Alias Generation

Database aliases are generated from the last path segment of the connection URI:
- `postgresql://host/mydb` -> `mydb`
- If duplicates exist, suffixes are added: `mydb`, `mydb_1`, `mydb_2`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TRANSACTION_TIMEOUT_MS` | 15000 | Transaction auto-rollback timeout |
| `MAX_CONCURRENT_TRANSACTIONS` | 10 | Max concurrent transactions |
| `PG_MAX_CONNECTIONS` | 20 | Max connections per pool |
| `PG_STATEMENT_TIMEOUT_MS` | 30000 | Query timeout |

## License

MIT
