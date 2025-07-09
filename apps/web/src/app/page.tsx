import { env } from "@/env";
import TodoApp from "./components/TodoApp";

function redactDatabaseUrl(url: string): string {
  if (!url) return "No DATABASE_URL found";

  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const port = parsed.port ? `:${parsed.port}` : "";
    const database = parsed.pathname.slice(1);

    return `postgresql://***:***@${host}${port}/${database}`;
  } catch {
    return "Invalid DATABASE_URL format";
  }
}

export default function Home() {
  let databaseUrl = "";
  let debugInfo = "";

  // Test different ways to access DATABASE_URL
  const rawProcessEnv = process.env.DATABASE_URL;
  let validatedEnv = "";
  let validatedError = "";

  try {
    validatedEnv = env.DATABASE_URL;
    debugInfo = `✅ env.DATABASE_URL accessed successfully (length: ${
      validatedEnv?.length || 0
    })`;
  } catch (error) {
    validatedError = String(error);
    debugInfo = `❌ env.DATABASE_URL failed: ${error}`;
  }

  // Use validated env if available, otherwise fallback
  databaseUrl = validatedEnv || rawProcessEnv || "";

  const redactedUrl = redactDatabaseUrl(databaseUrl);

  return (
    <div>
      <TodoApp databaseUrl={redactedUrl} />
      <div
        style={{
          position: "fixed",
          bottom: "10px",
          left: "10px",
          background: "yellow",
          padding: "5px",
          fontSize: "12px",
          maxWidth: "500px",
          zIndex: 1000,
        }}
      >
        <div>DEBUG: {debugInfo}</div>
        <div>Validated env length: {validatedEnv?.length || 0}</div>
        <div>Raw process.env length: {rawProcessEnv?.length || 0}</div>
        <div>Final URL length: {databaseUrl?.length || 0}</div>
        <div>Redacted result: {redactedUrl}</div>
        {validatedError && <div>Validation error: {validatedError}</div>}
        <div>NODE_ENV: {process.env.NODE_ENV}</div>
        <div>
          Context: {typeof window === "undefined" ? "server" : "client"}
        </div>
      </div>
    </div>
  );
}
