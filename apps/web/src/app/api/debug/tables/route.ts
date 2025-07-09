import { db } from "@/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Check if todos table exists
    const tableExists = await db.execute(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'todos'
      );
    `);

    // Try to count todos
    let todoCount = null;
    let todoCountError = null;

    try {
      const countResult = await db.execute(
        "SELECT COUNT(*) as count FROM todos"
      );
      todoCount = countResult.rows[0];
    } catch (error) {
      todoCountError = error instanceof Error ? error.message : String(error);
    }

    return NextResponse.json({
      status: "success",
      tableExists: tableExists.rows[0],
      todoCount,
      todoCountError,
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
