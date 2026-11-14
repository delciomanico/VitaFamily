// Serviço da lista da seguradora (BR-SEG-22; entities.md `InsurerService`): lista por seguradora, sem catálogo comum. Regras puras.
import { fail, requireText, requireUuid } from "./validation.js";

export type ServiceStatus = "ACTIVE" | "INACTIVE";

export interface InsurerService {
  id: string;
  insurerId: string;
  code: string;
  name: string;
  category: string | null;
  status: ServiceStatus;
  /** Fatia 2 (BR-SEG-39): nulo = por classificar. */
  serviceKindId: string | null;
  /** Derivados do tipo de serviço (só leitura). */
  guideType: string | null;
  expenseType: string | null;
  createdAt: Date;
}

function optionalCategory(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length === 0) return null;
  if (text.length > 80) fail("category", "no máximo 80 caracteres");
  return text;
}

export function parseServiceInput(input: { code?: unknown; name?: unknown; category?: unknown }): { code: string; name: string; category: string | null } {
  return { code: requireText(input.code, "code", 40), name: requireText(input.name, "name", 200), category: optionalCategory(input.category) };
}

export interface ServicePatch {
  name?: string;
  category?: string | null;
  status?: ServiceStatus;
  serviceKindId?: string | null;
}

/** BR-SEG-22/39: nome, categoria, estado e tipo de serviço; o código não se altera. */
export function parseServicePatch(input: { name?: unknown; category?: unknown; status?: unknown; serviceKindId?: unknown }): ServicePatch {
  const patch: ServicePatch = {};
  if (input.name !== undefined) patch.name = requireText(input.name, "name", 200);
  if (input.category !== undefined) patch.category = optionalCategory(input.category);
  if (input.status !== undefined) {
    if (input.status !== "ACTIVE" && input.status !== "INACTIVE") fail("status", "ACTIVE ou INACTIVE");
    patch.status = input.status;
  }
  if (input.serviceKindId !== undefined) patch.serviceKindId = input.serviceKindId === null ? null : requireUuid(input.serviceKindId, "serviceKindId");
  return patch;
}

export function parseServiceStatusFilter(value: unknown): ServiceStatus | undefined {
  if (value === undefined) return undefined;
  if (value !== "ACTIVE" && value !== "INACTIVE") fail("status", "ACTIVE ou INACTIVE", "Filtro inválido.");
  return value;
}
