import { prisma } from "@/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Test if we can access the todos table using Prisma
    let todoCount = null;
    let todoCountError = null;
    let tableAccessible = false;

    try {
      todoCount = await prisma.todo.count();
      tableAccessible = true;
    } catch (error) {
      todoCountError = error instanceof Error ? error.message : String(error);
      tableAccessible = false;
    }

    return NextResponse.json({
      status: "success",
      tableAccessible,
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
