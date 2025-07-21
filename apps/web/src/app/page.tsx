import { prisma } from "@/db";
import { env } from "@/env";
import TodoApp from "./components/TodoApp";

export default async function Home() {
  // Fetch todos server-side
  const initialTodos = await prisma.todo.findMany({
    orderBy: {
      createdAt: 'desc'
    }
  });

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
