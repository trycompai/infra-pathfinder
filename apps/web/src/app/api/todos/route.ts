import { db, todos } from "@/db";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

// GET /api/todos - List all todos
export async function GET() {
  try {
    console.log("Starting todos fetch...");

    // Test database connection first
    console.log("Testing basic database connection...");
    await db.execute("SELECT 1");
    console.log("Database connection OK");

    // Try the actual query
    console.log("Executing todos query...");
    const allTodos = await db
      .select()
      .from(todos)
      .orderBy(desc(todos.createdAt));

    console.log(`Found ${allTodos.length} todos`);
    return NextResponse.json(allTodos);
  } catch (error) {
    console.error("Detailed error in todos fetch:", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
    });

    return NextResponse.json(
      {
        error: "Failed to fetch todos",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

// POST /api/todos - Create a new todo
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { title } = body;

    if (!title || typeof title !== "string") {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const [newTodo] = await db
      .insert(todos)
      .values({ title: title.trim() })
      .returning();

    return NextResponse.json(newTodo, { status: 201 });
  } catch (error) {
    console.error("Failed to create todo:", error);
    return NextResponse.json(
      { error: "Failed to create todo" },
      { status: 500 }
    );
  }
}
