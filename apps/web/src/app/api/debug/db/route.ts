import { db, todos } from "@/db";
import { count } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Test basic database connection using Drizzle selectors
    const result = await db.select({ count: count() }).from(todos);

    return NextResponse.json({
      status: "success",
      message: "Database connection works",
      tableAccessible: true,
      todoCount: result[0]?.count || 0,
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
