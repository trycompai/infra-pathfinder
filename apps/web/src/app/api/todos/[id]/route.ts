import { db, todos } from "@/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

// PATCH /api/todos/[id] - Update a todo
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid todo ID" }, { status: 400 });
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
      return NextResponse.json({ error: "Todo not found" }, { status: 404 });
    }

    return NextResponse.json(updatedTodo);
  } catch (error) {
    console.error("Failed to update todo:", error);
    return NextResponse.json(
      { error: "Failed to update todo" },
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
      return NextResponse.json({ error: "Invalid todo ID" }, { status: 400 });
    }

    const [deletedTodo] = await db
      .delete(todos)
      .where(eq(todos.id, id))
      .returning();

    if (!deletedTodo) {
      return NextResponse.json({ error: "Todo not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Todo deleted successfully" });
  } catch (error) {
    console.error("Failed to delete todo:", error);
    return NextResponse.json(
      { error: "Failed to delete todo" },
      { status: 500 }
    );
  }
}
