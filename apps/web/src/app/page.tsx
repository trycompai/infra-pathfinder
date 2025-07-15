import { db, todos } from "@/db";
import { env } from "@/env";
import { desc } from "drizzle-orm";
import TodoApp from "./components/TodoApp";

export default async function Home() {
  // Fetch todos server-side
  const initialTodos = await db
    .select()
    .from(todos)
    .orderBy(desc(todos.createdAt));

  console.log("initialTodos", initialTodos);

  return (
    <div>
      <TodoApp initialTodos={initialTodos} />
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
        <div>T3 DATABASE_URL: {env.DATABASE_URL}</div>
        <div>Raw DATABASE_URL: {process.env.DATABASE_URL}</div>
        <div>NODE_ENV: {process.env.NODE_ENV}</div>
        <div>
          Context: {typeof window === "undefined" ? "server" : "client"}
        </div>
      </div>
    </div>
  );
}
