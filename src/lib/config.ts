/**
 * Configuration settings loaded from environment variables
 */

function parseIntEnv(envVar: string | undefined, defaultValue: number): number {
  if (!envVar) return defaultValue;
  const val = parseInt(envVar, 10);
  if (isNaN(val)) {
    console.error(`Warning: Invalid numeric value "${envVar}", using default ${defaultValue}`);
    return defaultValue;
  }
  return val;
}

export default {
  transactionTimeoutMs: parseIntEnv(process.env.TRANSACTION_TIMEOUT_MS, 15000),
  monitorIntervalMs: parseIntEnv(process.env.MONITOR_INTERVAL_MS, 5000),
  enableTransactionMonitor: process.env.ENABLE_TRANSACTION_MONITOR !== 'false',
  maxConcurrentTransactions: parseIntEnv(process.env.MAX_CONCURRENT_TRANSACTIONS, 10),
  pg: {
    maxConnections: parseIntEnv(process.env.PG_MAX_CONNECTIONS, 20),
    idleTimeoutMillis: parseIntEnv(process.env.PG_IDLE_TIMEOUT_MS, 30000),
    statementTimeout: parseIntEnv(process.env.PG_STATEMENT_TIMEOUT_MS, 30000),
  }
};
