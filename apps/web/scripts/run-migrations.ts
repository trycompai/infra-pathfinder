import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import { env } from "../src/env";

async function runMigrations() {
  console.log("🚀 Starting database migrations...");
  console.log(
    `🔗 Database URL: ${env.DATABASE_URL.replace(/:[^@]+@/, ":***@")}`
  ); // Hide password

  try {
    // Run Prisma migrations
    execSync("npx prisma migrate deploy", {
      env: {
        ...process.env,
        DATABASE_URL: env.DATABASE_URL,
      },
      stdio: "inherit",
    });

    console.log("✅ Migrations completed successfully!");

    // Verify connection
    const prisma = new PrismaClient();
    await prisma.$connect();
    console.log("✅ Database connection verified!");
    await prisma.$disconnect();

    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

// Run migrations
runMigrations();
