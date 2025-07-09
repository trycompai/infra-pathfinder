import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../env";
import * as schema from "./schema";

// Create a connection pool using validated environment variables
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

// Create the database instance
export const db = drizzle(pool, { schema });

// Export schema elements for use in other files
export * from "./schema";
