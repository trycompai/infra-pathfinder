import { db } from "@/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Test basic database connection
    const result = await db.execute("SELECT 1 as test");

    return NextResponse.json({
      status: "success",
      message: "Database connection works",
      result: result.rows,
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
