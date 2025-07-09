/* eslint-disable @typescript-eslint/no-require-imports */
const { defineConfig } = require("drizzle-kit");

module.exports = defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
});
