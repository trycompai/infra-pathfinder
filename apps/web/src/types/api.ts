import { todos } from "@/db";
import type { InferSelectModel } from "drizzle-orm";

// Database types
export type Todo = InferSelectModel<typeof todos>;

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface TodosResponse extends ApiResponse<Todo[]> {}
export interface TodoResponse extends ApiResponse<Todo> {}
export interface DeleteResponse extends ApiResponse {
  message: string;
} 