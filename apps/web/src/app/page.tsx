import { env } from "../env";
import TodoApp from "./components/TodoApp";

function redactDatabaseUrl(url: string): string {
  if (!url) return "No DATABASE_URL found";

  // Parse the URL to extract components
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const port = parsed.port ? `:${parsed.port}` : "";
    const database = parsed.pathname.slice(1); // Remove leading slash

    return `postgresql://***:***@${host}${port}/${database}`;
  } catch {
    return "Invalid DATABASE_URL format";
  }
}

export default function Home() {
  const redactedUrl = redactDatabaseUrl(env.DATABASE_URL);

  return <TodoApp databaseUrl={redactedUrl} />;
}
