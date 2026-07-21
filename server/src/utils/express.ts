import type { Response } from "express";
import { AuthError } from "../auth.js";

export function readRouteParam(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

export function readLimit(value: unknown, fallback: number): number {
  return typeof value === "string" ? Number(value) : fallback;
}

export function sendAuthError(response: Response, error: unknown, fallbackMessage: string): Response {
  if (error instanceof AuthError) {
    return response.status(error.status).json({ error: { code: error.code, message: error.message } });
  }
  console.error("Auth route error", error);
  return response.status(500).json({ error: { code: "AUTH_ERROR", message: fallbackMessage } });
}
