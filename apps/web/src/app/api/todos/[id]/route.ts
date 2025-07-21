import { prisma } from "@/db";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

// PUT /api/todos/[id] - Update a todo
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;

    const body = await request.json();
    const updates: {
      title?: string;
      completed?: boolean;
    } = {};

    if (typeof body.title === "string") {
      updates.title = body.title.trim();
    }

    if (typeof body.completed === "boolean") {
      updates.completed = body.completed;
    }

    const updatedTodo = await prisma.todo.update({
      where: { id: idParam },
      data: updates,
    });

    revalidatePath("/");

    return NextResponse.json({
      success: true,
      data: updatedTodo,
    });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return NextResponse.json(
        {
          success: false,
          error: "Todo not found",
        },
        { status: 404 }
      );
    }

    console.error("Failed to update todo:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to update todo",
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

    await prisma.todo.delete({
      where: { id: idParam },
    });

    revalidatePath("/");

    return NextResponse.json({
      success: true,
      message: "Todo deleted successfully",
    });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return NextResponse.json(
        {
          success: false,
          error: "Todo not found",
        },
        { status: 404 }
      );
    }

    console.error("Failed to delete todo:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to delete todo",
      },
      { status: 500 }
    );
  }
}
