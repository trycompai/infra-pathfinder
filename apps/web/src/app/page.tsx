import { env } from "@/env";
import TodoApp from "./components/TodoApp";

export default function Home() {
  return (
    <div>
      <TodoApp databaseUrl={env.DATABASE_URL} />
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
