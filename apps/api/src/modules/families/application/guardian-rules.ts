// Validação partilhada de tutores (BR-MEM-03..08) — usada por `create-member`, `set-dependent`,
// `add-guardian`. Faz I/O (lê membros via repositório), por isso vive em `application`, não `domain`.
import { DomainError } from "../../../platform/errors/index.js";
import { assertEligibleGuardian } from "./membership.js";
import type { FamiliesDeps } from "./ports.js";

export interface ResolvedGuardians {
  guardianIds: string[];
  primaryGuardianId: string;
}

/**
 * BR-MEM-03: todo dependente tem ≥1 tutor. BR-MEM-06: exatamente um principal. Valida cada tutor
 * (BR-MEM-05) e que o principal pedido está entre os tutores indicados.
 */
export async function resolveGuardiansForDependent<Trx>(
  deps: FamiliesDeps<Trx>,
  trx: Trx,
  familyId: string,
  dependentId: string,
  guardianMemberIds: string[] | undefined,
  primaryGuardianMemberId: string | null | undefined,
  now: Date,
): Promise<ResolvedGuardians> {
  const ids = guardianMemberIds ?? [];
  if (ids.length === 0) {
    throw new DomainError("DEPENDENT_REQUIRES_GUARDIAN", { detail: "Indique pelo menos um tutor." });
  }
  const uniqueIds = [...new Set(ids)];
  for (const guardianId of uniqueIds) {
    const candidate = await deps.membersRepo.findById(trx, familyId, guardianId);
    if (!candidate) {
      throw new DomainError("GUARDIAN_INVALID", { detail: "Tutor inválido." });
    }
    assertEligibleGuardian(candidate, dependentId, now);
  }
  const primaryGuardianId = primaryGuardianMemberId ?? uniqueIds[0];
  if (primaryGuardianId === undefined || !uniqueIds.includes(primaryGuardianId)) {
    throw new DomainError("GUARDIAN_INVALID", { detail: "Tutor principal tem de estar entre os tutores." });
  }
  return { guardianIds: uniqueIds, primaryGuardianId };
}
