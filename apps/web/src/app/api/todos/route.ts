import { db, todos } from "@/db";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

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

    revalidatePath("/");

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
