"use client";

import { todosApi } from "@/services/api";
import type { Todo } from "@/types/api";
import { useState } from "react";

type TodoAppProps = {
  initialTodos: Todo[];
};

export default function TodoApp({ initialTodos }: TodoAppProps) {
  const [todos, setTodos] = useState<Todo[]>(initialTodos);
  const [newTodo, setNewTodo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTodo.trim()) return;

    try {
      const newTodoItem = await todosApi.createTodo(newTodo.trim());
      setTodos((prev) => [newTodoItem, ...prev]);
      setNewTodo("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add todo");
      console.error(err);
    }
  };

  const toggleTodo = async (id: string, completed: boolean) => {
    try {
      const updatedTodo = await todosApi.updateTodo(id, { completed });
      setTodos((prev) =>
        prev.map((todo) => (todo.id === id ? updatedTodo : todo))
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update todo");
      console.error(err);
    }
  };

  const deleteTodo = async (id: string) => {
    try {
      await todosApi.deleteTodo(id);
      setTodos((prev) => prev.filter((todo) => todo.id !== id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete todo");
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
        {todos.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No todos yet. Add one above!
          </div>
        ) : (
          <ul className="space-y-2">
            {todos.map((todo) => (
              <li
                key={todo.id}
                className="flex items-center gap-3 p-4 bg-white dark:bg-gray-800 
                         border border-gray-200 dark:border-gray-700 rounded-lg"
              >
                <input
                  type="checkbox"
                  checked={todo.completed}
                  onChange={(e) => toggleTodo(todo.id, e.target.checked)}
                  className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                />
                <span
                  className={`flex-1 ${
                    todo.completed
                      ? "line-through text-gray-500 dark:text-gray-400"
                      : "text-black dark:text-white"
                  }`}
                >
                  {todo.title}
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {new Date(todo.createdAt).toLocaleDateString()}
                </span>
                <button
                  onClick={() => deleteTodo(todo.id)}
                  className="px-3 py-1 text-red-600 hover:text-red-800 
                           dark:text-red-400 dark:hover:text-red-200
                           transition-colors"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
        
        {/* Debug info */}
        <div className="mt-8 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
          <h3 className="font-semibold mb-2">Debug Info:</h3>
          <p className="text-sm">Initial todos loaded: {initialTodos.length}</p>
          <p className="text-sm">Current todos count: {todos.length}</p>
        </div>
      </main>
    </div>
  );
}
