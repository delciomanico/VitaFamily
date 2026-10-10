// openapi.yaml `createPrivateClinic`: "Autorização: FAM_MEMBER (adulto). BR-CLN-01: máx. 10 por
// família (B4)." UC-CLN-01.
import { newId } from "../../../platform/ids/index.js";
import { DomainError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertValidClinicName, MAX_PRIVATE_CLINICS_PER_FAMILY, type Clinic } from "../domain/clinic.js";
import type { ActorIdentity, ClinicsDeps, NewClinicRecord, RequestContext } from "./ports.js";
import { requireAdultMember, requireMembership } from "./support.js";

export interface CreatePrivateClinicInput {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

export function createCreatePrivateClinicUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function createPrivateClinic(actor: ActorIdentity, familyId: string, input: CreatePrivateClinicInput, context: RequestContext): Promise<Clinic> {
    const name = assertValidClinicName(input.name);

    return deps.withTransaction(async (trx) => {
      const facts = await requireMembership(deps, trx, familyId, actor.userId);
      requireAdultMember(facts);

      const existing = await deps.clinicsRepo.countPrivateByFamily(trx, familyId);
      if (existing >= MAX_PRIVATE_CLINICS_PER_FAMILY) {
        throw new DomainError("LIMIT_EXCEEDED", { detail: "Limite de clínicas privadas atingido." });
      }

      const now = deps.clock.now();
      const record: NewClinicRecord = {
        id: newId(),
        type: "PRIVATE",
        familyId,
        name,
        createdBy: actor.userId,
        createdAt: now,
        ...(input.address ? { address: input.address } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
        ...(input.email ? { email: input.email } : {}),
      };
      const clinic = await deps.clinicsRepo.insert(trx, record);

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "CLINIC_CREATE",
        resourceType: "Clinic",
        resourceId: clinic.id,
        familyId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return clinic;
    });
  };
}
