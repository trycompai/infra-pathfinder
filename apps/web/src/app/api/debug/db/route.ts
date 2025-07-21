import { prisma } from "@/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Test basic database connection using Prisma
    const todoCount = await prisma.todo.count();

    return NextResponse.json({
      status: "success",
      message: "Database connection works",
      tableAccessible: true,
      todoCount,
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
