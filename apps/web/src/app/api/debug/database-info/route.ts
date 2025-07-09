import { db } from "@/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Check what tables exist in the database
    const tablesResult = await db.execute(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    // Check if drizzle migration table exists
    const migrationTableResult = await db.execute(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = '__drizzle_migrations'
      );
    `);

    // If migration table exists, check migration status
    let migrationHistory = null;
    if (migrationTableResult.rows[0]?.exists) {
      const historyResult = await db.execute(`
        SELECT hash, created_at 
        FROM "__drizzle_migrations" 
        ORDER BY created_at;
      `);
      migrationHistory = historyResult.rows;
    }

    return NextResponse.json({
      status: "success",
      database: {
        allTables: tablesResult.rows,
        hasMigrationTable: migrationTableResult.rows[0]?.exists || false,
        migrationHistory,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
