// Auxiliares HTTP partilhados pelos routers de `messaging` (leitura defensiva de query e corpo; nunca se regista corpo, BR-MKT-46).
import type { Request } from "express";

export function queryInt(req: Request, name: string): number | undefined {
  const value = req.query[name];
  if (typeof value === "number") return value;
  return typeof value === "string" && /^\d+$/.test(value) ? Number(value) : undefined;
}

export function queryString(req: Request, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === "string" ? value : undefined;
}

export function body(req: Request): Record<string, unknown> {
  return typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : {};
}

export function optionalString(value: unknown): { v?: string } {
  return typeof value === "string" ? { v: value } : {};
}

