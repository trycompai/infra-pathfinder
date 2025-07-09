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

  try {
    databaseUrl = env.DATABASE_URL;
    debugInfo = "✅ env.DATABASE_URL accessed successfully";
  } catch (error) {
    debugInfo = `❌ env.DATABASE_URL failed: ${error}`;
    // Fallback to raw env
    if (process.env.DATABASE_URL) {
      databaseUrl = process.env.DATABASE_URL;
      debugInfo += " | ✅ process.env.DATABASE_URL fallback worked";
    } else {
      debugInfo += " | ❌ process.env.DATABASE_URL also empty";
    }
  }

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
          maxWidth: "300px",
        }}
      >
        DEBUG: {debugInfo}
      </div>
    </div>
  );
}
