import { todos } from "@/db";
import type { InferSelectModel } from "drizzle-orm";

// Database types
export type Todo = InferSelectModel<typeof todos>;

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface TodosResponse extends ApiResponse<Todo[]> {
  data: Todo[];
}

export interface TodoResponse extends ApiResponse<Todo> {
  data: Todo;
}

export interface DeleteResponse extends ApiResponse<never> {
  message: string;
} 