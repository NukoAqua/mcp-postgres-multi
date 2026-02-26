import pg from "pg";

// Constants
export const SCHEMA_PATH = "schema";

// Transaction management
export interface TrackedTransaction {
  id: string;
  database: string;   // alias of the database
  client: pg.PoolClient;
  startTime: number;
  sql: string;
  state: 'active' | 'terminating';
  released: boolean; // Track if this client has been released
}
