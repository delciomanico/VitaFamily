// Helpers de autorização ESTRUTURAL (authorization.md §4: "Clínicas privadas" — não passa por
// `AccessPolicy.can()`, que só decide categorias de dados de saúde; aqui decide-se pertença,
// idade e papel/criador, mesmo critério de `families/application/membership.ts`).
import { ForbiddenError, NotFoundError } from "../../../platform/errors/index.js";
import type { Clinic } from "../domain/clinic.js";
import type { ClinicsDeps, MembershipFacts } from "./ports.js";

/** Pertença à família (authorization.md §2 passo 3): nunca revela se a família existe. */
export async function requireMembership<Trx>(deps: ClinicsDeps<Trx>, trx: Trx, familyId: string, userId: string): Promise<MembershipFacts> {
  const facts = await deps.access.getMembershipFacts(trx, familyId, userId);
  if (!facts) {
    throw new NotFoundError({ detail: "Família não encontrada." });
  }
  return facts;
}

/** UC-CLN-01/authorization.md §4: criar clínica privada exige um adulto da família. */
export function requireAdultMember(facts: MembershipFacts): void {
  if (!facts.isAdult) {
    throw new ForbiddenError({ detail: "Só um adulto da família pode criar uma clínica privada." });
  }
}

/** authorization.md §4: editar/arquivar/eliminar clínica privada — criador ou FAMILY_ADMIN. */
export function requireCreatorOrFamilyAdmin(facts: MembershipFacts, actorUserId: string, clinic: Pick<Clinic, "createdBy">): void {
  const isCreator = clinic.createdBy !== undefined && clinic.createdBy === actorUserId;
  const isFamilyAdmin = facts.role === "FAMILY_ADMIN";
  if (!isCreator && !isFamilyAdmin) {
    throw new ForbiddenError({ detail: "Sem permissão sobre esta clínica." });
  }
}

/** Carrega uma clínica PRIVATE da família do pedido; nunca revela clínicas de outra família/parceiras por aqui. */
export async function requirePrivateClinicOfFamily<Trx>(deps: ClinicsDeps<Trx>, trx: Trx, familyId: string, clinicId: string): Promise<Clinic> {
  const clinic = await deps.clinicsRepo.findById(trx, clinicId);
  if (!clinic) {
    throw new NotFoundError({ detail: "Clínica não encontrada." });
  }
  if (clinic.type !== "PRIVATE" || clinic.familyId !== familyId) {
    throw new NotFoundError({ detail: "Clínica não encontrada." });
  }
  return clinic;
}

/** Carrega uma clínica PARTNER (admin); nunca revela clínicas privadas por aqui. */
export async function requirePartnerClinic<Trx>(deps: ClinicsDeps<Trx>, trx: Trx, clinicId: string): Promise<Clinic> {
  const clinic = await deps.clinicsRepo.findById(trx, clinicId);
  if (!clinic) {
    throw new NotFoundError({ detail: "Clínica não encontrada." });
  }
  if (clinic.type !== "PARTNER") {
    throw new NotFoundError({ detail: "Clínica não encontrada." });
  }
  return clinic;
}
