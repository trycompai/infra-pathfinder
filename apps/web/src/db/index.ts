import awsCaBundle from "aws-ssl-profiles";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../env";
import * as schema from "./schema";

// Create a connection pool using validated environment variables
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  // Use AWS CA bundle for SSL verification
  ssl: awsCaBundle,
});

// Create the database instance
export const db = drizzle(pool, { schema });

// Export schema elements for use in other files
export * from "./schema";
