#!/usr/bin/env tsx

import { env } from "../src/env";

console.log("🔍 Environment Variable Test");
console.log("============================");

try {
  console.log("✅ DATABASE_URL:", env.DATABASE_URL.replace(/:[^@]+@/, ":***@"));
  console.log("✅ NODE_ENV:", env.NODE_ENV);
  console.log("🎉 All environment variables are valid!");
} catch (error) {
  console.error("❌ Environment validation failed:");
  console.error(error);
  process.exit(1);
}
