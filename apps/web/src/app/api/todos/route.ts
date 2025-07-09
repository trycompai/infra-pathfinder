import { db, todos } from "@/db";
import { count, desc } from "drizzle-orm";
import { NextResponse } from "next/server";

interface DebugStep {
  step: number;
  action?: string;
  result?: string;
  todoCount?: number;
  todosReturned?: number;
  todoId?: number;
  title?: string;
  message?: string;
}

interface ErrorInfo {
  message: string;
  name: string;
  stack?: string;
  code?: string;
  detail?: string;
  hint?: string;
}

interface DebugInfo {
  timestamp: string;
  steps: DebugStep[];
  environment?: {
    NODE_ENV: string | undefined;
    DATABASE_URL_exists: boolean;
    DATABASE_URL_length: number;
  };
  error?: ErrorInfo;
}

// GET /api/todos - List all todos
export async function GET() {
  const debugInfo: DebugInfo = {
    timestamp: new Date().toISOString(),
    steps: [],
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      DATABASE_URL_exists: !!process.env.DATABASE_URL,
      DATABASE_URL_length: process.env.DATABASE_URL?.length || 0,
    },
  };

  try {
    // Step 1: Test basic table access with count
    debugInfo.steps.push({
      step: 1,
      action: "Testing table access with count query",
    });
    const countResult = await db.select({ count: count() }).from(todos);
    const todoCount = countResult[0]?.count || 0;
    debugInfo.steps.push({
      step: 1,
      result: "success",
      todoCount,
      message: `Table accessible, found ${todoCount} todos`,
    });

    // Step 2: Try to fetch actual todos
    debugInfo.steps.push({
      step: 2,
      action: "Fetching all todos with ordering",
    });
    const allTodos = await db
      .select()
      .from(todos)
      .orderBy(desc(todos.createdAt));

    debugInfo.steps.push({
      step: 2,
      result: "success",
      todosReturned: allTodos.length,
      message: `Successfully fetched ${allTodos.length} todos`,
    });

    console.log("Todos fetch successful:", debugInfo);
    return NextResponse.json({
      success: true,
      data: allTodos,
      debug: debugInfo,
    });
  } catch (error) {
    const errorInfo = {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "Unknown",
      stack: error instanceof Error ? error.stack : undefined,
      code: (error as { code?: string })?.code,
      detail: (error as { detail?: string })?.detail,
      hint: (error as { hint?: string })?.hint,
    };

    debugInfo.error = errorInfo;

    console.error("Detailed error in todos fetch:", debugInfo);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch todos",
        message: errorInfo.message,
        debug: debugInfo,
        details: errorInfo,
      },
      { status: 500 }
    );
  }
}

// POST /api/todos - Create a new todo
export async function POST(request: Request) {
  const debugInfo: DebugInfo = {
    timestamp: new Date().toISOString(),
    steps: [],
  };

  try {
    debugInfo.steps.push({ step: 1, action: "Parsing request body" });
    const body = await request.json();
    const { title } = body;

    if (!title || typeof title !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: "Title is required and must be a string",
          debug: debugInfo,
        },
        { status: 400 }
      );
    }

    debugInfo.steps.push({
      step: 1,
      result: "success",
      title: title.trim(),
      message: "Request body parsed successfully",
    });

    debugInfo.steps.push({
      step: 2,
      action: "Inserting new todo into database",
    });
    const [newTodo] = await db
      .insert(todos)
      .values({ title: title.trim() })
      .returning();

    debugInfo.steps.push({
      step: 2,
      result: "success",
      todoId: newTodo.id,
      message: `Todo created with ID ${newTodo.id}`,
    });

    console.log("Todo creation successful:", debugInfo);
    return NextResponse.json(
      {
        success: true,
        data: newTodo,
        debug: debugInfo,
      },
      { status: 201 }
    );
  } catch (error) {
    const errorInfo = {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "Unknown",
      stack: error instanceof Error ? error.stack : undefined,
      code: (error as { code?: string })?.code,
      detail: (error as { detail?: string })?.detail,
      hint: (error as { hint?: string })?.hint,
    };

    debugInfo.error = errorInfo;

    console.error("Detailed error in todo creation:", debugInfo);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to create todo",
        message: errorInfo.message,
        debug: debugInfo,
        details: errorInfo,
      },
      { status: 500 }
    );
  }
}
