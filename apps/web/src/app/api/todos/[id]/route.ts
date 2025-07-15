import { db, todos } from "@/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

// PUT /api/todos/[id] - Update a todo
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (isNaN(id)) {
      return NextResponse.json(
        { 
          success: false,
          error: "Invalid todo ID" 
        }, 
        { status: 400 }
      );
    }

    const body = await request.json();
    const updates: Partial<{
      title: string;
      completed: boolean;
      updatedAt: Date;
    }> = {
      updatedAt: new Date(),
    };

    if (typeof body.title === "string") {
      updates.title = body.title.trim();
    }

    if (typeof body.completed === "boolean") {
      updates.completed = body.completed;
    }

    const [updatedTodo] = await db
      .update(todos)
      .set(updates)
      .where(eq(todos.id, id))
      .returning();

    if (!updatedTodo) {
      return NextResponse.json(
        { 
          success: false,
          error: "Todo not found" 
        }, 
        { status: 404 }
      );
    }

    revalidatePath("/");

    return NextResponse.json({
      success: true,
      data: updatedTodo,
    });
  } catch (error) {
    console.error("Failed to update todo:", error);
    return NextResponse.json(
      { 
        success: false,
        error: "Failed to update todo" 
      },
      { status: 500 }
    );
  }
}

// DELETE /api/todos/[id] - Delete a todo
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (isNaN(id)) {
      return NextResponse.json(
        { 
          success: false,
          error: "Invalid todo ID" 
        }, 
        { status: 400 }
      );
    }

    const [deletedTodo] = await db
      .delete(todos)
      .where(eq(todos.id, id))
      .returning();

    revalidatePath("/");

    if (!deletedTodo) {
      return NextResponse.json(
        { 
          success: false,
          error: "Todo not found" 
        }, 
        { status: 404 }
      );
    }

    revalidatePath("/");

    return NextResponse.json({ 
      success: true,
      message: "Todo deleted successfully" 
    });
  } catch (error) {
    console.error("Failed to delete todo:", error);
    return NextResponse.json(
      { 
        success: false,
        error: "Failed to delete todo" 
      },
      { status: 500 }
    );
  }
}
