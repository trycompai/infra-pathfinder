import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "path";
import { db } from "../src/db";
import { env } from "../src/env";

async function runMigrations() {
  console.log("🚀 Starting database migrations...");
  console.log(
    `📁 Migration directory: ${path.join(__dirname, "../src/db/migrations")}`
  );
  console.log(
    `🔗 Database URL: ${env.DATABASE_URL.replace(/:[^@]+@/, ":***@")}`
  ); // Hide password

  try {
    await migrate(db, {
      migrationsFolder: path.join(__dirname, "../src/db/migrations"),
    });

    console.log("✅ Migrations completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

// Run migrations
runMigrations();
