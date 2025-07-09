"use client";

import { useEffect, useState } from "react";

type Todo = {
  id: number;
  title: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
};

type TodoAppProps = {
  databaseUrl: string;
};

export default function TodoApp({ databaseUrl }: TodoAppProps) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTodo, setNewTodo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch todos on mount
  useEffect(() => {
    fetchTodos();
  }, []);

  const fetchTodos = async () => {
    try {
      const response = await fetch("/api/todos");
      if (!response.ok) throw new Error("Failed to fetch todos");
      const data = await response.json();
      setTodos(data);
      setError(null);
    } catch (err) {
      setError("Failed to load todos. Is your database connected?");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const addTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTodo.trim()) return;

    try {
      const response = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTodo }),
      });

      if (!response.ok) throw new Error("Failed to create todo");

      const todo = await response.json();
      setTodos([todo, ...todos]);
      setNewTodo("");
      setError(null);
    } catch (err) {
      setError("Failed to create todo");
      console.error(err);
    }
  };

  const toggleTodo = async (id: number, completed: boolean) => {
    try {
      const response = await fetch(`/api/todos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: !completed }),
      });

      if (!response.ok) throw new Error("Failed to update todo");

      const updatedTodo = await response.json();
      setTodos(todos.map((todo) => (todo.id === id ? updatedTodo : todo)));
      setError(null);
    } catch (err) {
      setError("Failed to update todo");
      console.error(err);
    }
  };

  const deleteTodo = async (id: number) => {
    try {
      const response = await fetch(`/api/todos/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete todo");

      setTodos(todos.filter((todo) => todo.id !== id));
      setError(null);
    } catch (err) {
      setError("Failed to delete todo");
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen p-8 pb-20 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="max-w-2xl mx-auto">
        <h1 className="text-4xl font-bold mb-8 text-center">Todo App</h1>

        {/* Database Connection Status */}
        <div
          className={`mb-6 p-4 rounded-lg text-center ${
            error
              ? "bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400"
              : "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400"
          }`}
        >
          {error ? `❌ ${error}` : "✅ Database Connected"}
        </div>

        {/* Add Todo Form */}
        <form onSubmit={addTodo} className="mb-8">
          <div className="flex gap-2">
            <input
              type="text"
              value={newTodo}
              onChange={(e) => setNewTodo(e.target.value)}
              placeholder="Add a new todo..."
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg 
                       bg-white dark:bg-gray-800 text-black dark:text-white
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={!newTodo.trim()}
              className="px-6 py-2 bg-blue-500 text-white rounded-lg 
                       hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors"
            >
              Add
            </button>
          </div>
        </form>

        {/* Todo List */}
        {loading ? (
          <div className="text-center py-8">Loading todos...</div>
        ) : todos.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No todos yet. Add one above!
          </div>
        ) : (
          <ul className="space-y-2">
            {todos.map((todo) => (
              <li
                key={todo.id}
                className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg"
              >
                <input
                  type="checkbox"
                  checked={todo.completed}
                  onChange={() => toggleTodo(todo.id, todo.completed)}
                  className="w-5 h-5 cursor-pointer"
                />
                <span
                  className={`flex-1 ${
                    todo.completed
                      ? "line-through text-gray-500"
                      : "text-gray-900 dark:text-gray-100"
                  }`}
                >
                  {todo.title}
                </span>
                <button
                  onClick={() => deleteTodo(todo.id)}
                  className="px-3 py-1 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/20 
                           rounded transition-colors"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Database Info */}
        <div className="mt-12 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
          <h2 className="font-semibold mb-2">Database Info:</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
            This app is using Drizzle ORM with PostgreSQL.
            {todos.length > 0 &&
              ` Currently storing ${todos.length} todo${
                todos.length === 1 ? "" : "s"
              }.`}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 font-mono break-all">
            📊 Database URL: {databaseUrl}
          </p>
        </div>
      </main>
    </div>
  );
}
