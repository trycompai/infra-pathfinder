import { prisma } from "@/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Check what tables exist in the database
    const tablesResult = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;

    // Check if Prisma migration table exists
    const migrationTableResult = await prisma.$queryRaw<
      Array<{ exists: boolean }>
    >`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = '_prisma_migrations'
      );
    `;

    // If migration table exists, check migration status
    let migrationHistory = null;
    if (migrationTableResult[0]?.exists) {
      migrationHistory = await prisma.$queryRaw<
        Array<{
          id: string;
          applied_steps_count: number;
          started_at: Date;
          finished_at: Date;
        }>
      >`
        SELECT id, applied_steps_count, started_at, finished_at 
        FROM "_prisma_migrations" 
        ORDER BY started_at;
      `;
    }

    return NextResponse.json({
      status: "success",
      database: {
        allTables: tablesResult,
        hasMigrationTable: migrationTableResult[0]?.exists || false,
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
