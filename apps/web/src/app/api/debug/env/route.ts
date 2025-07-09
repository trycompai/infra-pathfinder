import { env } from "@/env";
import { NextResponse } from "next/server";

// Debug endpoint to test if the validated env works
export async function GET() {
  // Only allow in development or if explicitly enabled
  if (
    process.env.NODE_ENV !== "development" &&
    !process.env.ENABLE_DEBUG_ENDPOINTS
  ) {
    return NextResponse.json(
      { error: "Debug endpoints disabled" },
      { status: 403 }
    );
  }

  try {
    // Try to access the validated environment variables
    const result = {
      status: "success",
      env: {
        DATABASE_URL: env.DATABASE_URL.replace(/:[^@]+@/, ":***@"), // Redacted
        NODE_ENV: env.NODE_ENV,
      },
      raw: {
        DATABASE_URL_exists: !!process.env.DATABASE_URL,
        DATABASE_URL_length: process.env.DATABASE_URL?.length || 0,
      },
    };

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        raw: {
          DATABASE_URL_exists: !!process.env.DATABASE_URL,
          DATABASE_URL_length: process.env.DATABASE_URL?.length || 0,
          SKIP_ENV_VALIDATION: process.env.SKIP_ENV_VALIDATION,
        },
      },
      { status: 500 }
    );
  }
}
