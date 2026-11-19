// Auxiliares HTTP de `consultations` (leitura defensiva de query e corpo; nunca se regista corpo nem query, BR-MKT-63).
import type { Request } from "express";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import type { ActorIdentity } from "../application/ports.js";

export function requireActor(): ActorIdentity {
  const actor = getActor();
  if (!actor) throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  return { userId: actor.userId, platformAdmin: actor.platformAdmin };
}

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

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
