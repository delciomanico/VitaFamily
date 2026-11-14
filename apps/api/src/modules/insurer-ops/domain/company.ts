// Empresa cliente da seguradora (UC-SEG-01, entities.md `Company`). Entidade pura.
import { requireText, fail } from "./validation.js";

export type CompanyStatus = "ACTIVE" | "INACTIVE";

export interface Company {
  id: string;
  insurerId: string;
  name: string;
  taxId: string;
  status: CompanyStatus;
  createdAt: Date;
}

export function parseCompanyInput(input: { name?: unknown; taxId?: unknown }): { name: string; taxId: string } {
  return { name: requireText(input.name, "name", 200), taxId: requireText(input.taxId, "taxId", 40) };
}

export interface CompanyPatch {
  name?: string;
  status?: CompanyStatus;
}

/** UC-SEG-01: só nome e/ou estado (o NIF não se altera). */
export function parseCompanyPatch(input: { name?: unknown; status?: unknown }): CompanyPatch {
  const patch: CompanyPatch = {};
  if (input.name !== undefined) patch.name = requireText(input.name, "name", 200);
  if (input.status !== undefined) {
    if (input.status !== "ACTIVE" && input.status !== "INACTIVE") fail("status", "ACTIVE ou INACTIVE");
    patch.status = input.status;
  }
  return patch;
}
