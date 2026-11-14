// Ligação clínica↔seguradora (`insurer_providers`, Fase A: só `clinic_id`; BR-SEG-18/§8.4). Regras puras.
import { fail, requireUuid } from "./validation.js";

export type ProviderStatus = "ACTIVE" | "SUSPENDED";

export interface InsurerProvider {
  id: string;
  insurerId: string;
  clinicId: string | null;
  /** Nome da clínica parceira à data da ligação. */
  name: string;
  status: ProviderStatus;
  createdAt: Date;
}

export function parseProviderInput(input: { clinicId?: unknown }): { clinicId: string } {
  return { clinicId: requireUuid(input.clinicId, "clinicId") };
}

export function parseProviderStatus(value: unknown): ProviderStatus {
  if (value !== "ACTIVE" && value !== "SUSPENDED") fail("status", "ACTIVE ou SUSPENDED");
  return value;
}

export function parseProviderStatusFilter(value: unknown): ProviderStatus | undefined {
  if (value === undefined) return undefined;
  if (value !== "ACTIVE" && value !== "SUSPENDED") fail("status", "ACTIVE ou SUSPENDED", "Filtro inválido.");
  return value;
}
