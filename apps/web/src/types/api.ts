import type { Todo as PrismaTodo } from "../generated/client";

// Database types
export type Todo = PrismaTodo;

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
