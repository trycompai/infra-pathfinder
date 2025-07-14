import type { DeleteResponse, Todo, TodoResponse, TodosResponse } from "@/types/api";
import axios from "axios";

const api = axios.create({
  baseURL: "/api",
  headers: {
    "Content-Type": "application/json",
  },
});

export const todosApi = {
  // Get all todos (mainly for refetch after mutations)
  getTodos: async (): Promise<Todo[]> => {
    const response = await api.get<TodosResponse>("/todos");
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error || "Failed to fetch todos");
  },

  // Create a new todo
  createTodo: async (title: string): Promise<Todo> => {
    const response = await api.post<TodoResponse>("/todos", { title });
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error || "Failed to create todo");
  },

  // Update a todo
  updateTodo: async (id: number, updates: Partial<Pick<Todo, "title" | "completed">>): Promise<Todo> => {
    const response = await api.put<TodoResponse>(`/todos/${id}`, updates);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error || "Failed to update todo");
  },

  // Delete a todo
  deleteTodo: async (id: number): Promise<void> => {
    const response = await api.delete<DeleteResponse>(`/todos/${id}`);
    if (!response.data.success) {
      throw new Error(response.data.error || "Failed to delete todo");
    }
  },
}; 