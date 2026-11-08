// Perfil da própria clínica (M14 R, BR-CLN-38, UC-CLN-29): `GET` (Admin e Gestor) e `PATCH` (só Admin) em
// `/clinic-portal/profile`. O `clinicId` vem sempre do token; só clínicas PARCEIRAS têm perfil. Auditoria
// `CLINIC_PROFILE_UPDATE` com os NOMES dos campos alterados (nunca os valores, audit.md §3).
import { ForbiddenError, NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { Clinic } from "../domain/clinic.js";
import { parseProfilePatch, type ClinicProfile } from "../domain/clinic-profile.js";
import type { ClinicPortalActor, ClinicsDeps, RequestContext } from "./ports.js";

export type { ClinicProfile } from "../domain/clinic-profile.js";

export function toClinicProfile(clinic: Clinic, currency: string): ClinicProfile {
  return {
    name: clinic.name,
    displayName: clinic.displayName ?? null,
    address: clinic.address ?? null,
    phone: clinic.phone ?? null,
    email: clinic.email ?? null,
    openingHours: clinic.openingHours ?? null,
    description: clinic.description ?? null,
    currency,
  };
}

async function loadPartner<Trx>(deps: ClinicsDeps<Trx>, trx: Trx, clinicId: string): Promise<Clinic> {
  const clinic = await deps.clinicsRepo.findById(trx, clinicId);
  if (clinic?.type !== "PARTNER") {
    throw new NotFoundError({ detail: "Clínica não encontrada." });
  }
  return clinic;
}

export function createGetClinicProfileUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function getClinicProfile(actor: ClinicPortalActor): Promise<ClinicProfile> {
    if (actor.role === "CLINIC_DOCTOR") {
      throw new ForbiddenError({ detail: "Sem permissão para o perfil da clínica." });
    }
    return deps.withTransaction(async (trx) => toClinicProfile(await loadPartner(deps, trx, actor.clinicId), await deps.catalogRepo.getCurrency(trx, actor.clinicId)));
  };
}

export function createUpdateClinicProfileUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function updateClinicProfile(actor: ClinicPortalActor, body: unknown, context: RequestContext): Promise<ClinicProfile> {
    if (actor.role !== "CLINIC_ADMIN") {
      throw new ForbiddenError({ detail: "Só o Admin da clínica edita o perfil." });
    }
    const patch = parseProfilePatch(body);
    return deps.withTransaction(async (trx) => {
      await loadPartner(deps, trx, actor.clinicId);
      const updated = await deps.clinicsRepo.update(trx, actor.clinicId, patch);
      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        actorClinicId: actor.clinicId,
        action: "CLINIC_PROFILE_UPDATE",
        resourceType: "Clinic",
        resourceId: actor.clinicId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { fields: Object.keys(patch).sort().join(",") },
      });
      return toClinicProfile(updated, await deps.catalogRepo.getCurrency(trx, actor.clinicId));
    });
  };
}
