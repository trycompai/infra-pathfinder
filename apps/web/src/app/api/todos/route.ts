import { db, todos } from "@/db";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

// GET /api/todos - List all todos (simplified, mainly for refetch after mutations)
export async function GET() {
  try {
    const allTodos = await db
      .select()
      .from(todos)
      .orderBy(desc(todos.createdAt));

    return NextResponse.json({
      success: true,
      data: allTodos,
    });
  } catch (error) {
    console.error("Error fetching todos:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch todos",
      },
      { status: 500 }
    );
  }
}

// POST /api/todos - Create a new todo
export async function POST(request: Request) {
  try {
    const { title } = await request.json();
    
    if (!title?.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: "Title is required",
        },
        { status: 400 }
      );
    }

    const [newTodo] = await db
      .insert(todos)
      .values({
        title: title.trim(),
        completed: false,
      })
      .returning();

    return NextResponse.json({
      success: true,
      data: newTodo,
    });
  } catch (error) {
    console.error("Error creating todo:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to create todo",
      },
      { status: 500 }
    );
  }
}
