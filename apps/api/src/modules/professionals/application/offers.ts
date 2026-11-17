// Ofertas e preços em Kz (UC-MKT-08, BR-MKT-03/24/31). Escrita: transação única com `FOR UPDATE` do profissional (serializa o limite de 20
// ativas e o duplicado ativo); estado lido da BD (BR-MKT-29); `REJECTED`/`SUSPENDED` ⇒ `PROFESSIONAL_LOCKED`, mas ofertas/preços são
// editáveis em `APPROVED` (OP-62). Auditoria SEM preços nem notas (audit.md §3).
import { ConflictError, DomainError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { MAX_ACTIVE_OFFERS, validateOfferInput, validateOfferPatch } from "../domain/offer.js";
import { assertCanWrite } from "../domain/validation-status.js";
import { auditDeniedOnLock } from "./denied.js";
import type { OfferRecord, ProfessionalsDeps, RequestContext } from "./ports.js";
import type { ProfessionalActor } from "./profile.js";

const DUPLICATE = "Já existe uma oferta ativa com a mesma especialidade, método e duração.";

export function createListOffersUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function listOffers(actor: ProfessionalActor, query: { active?: boolean }): Promise<OfferRecord[]> {
    return deps.withTransaction((trx) => deps.offerRepo.list(trx, actor.professionalId, query));
  };
}

export function createCreateOfferUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function createOffer(actor: ProfessionalActor, input: Record<string, unknown>, context: RequestContext): Promise<OfferRecord> {
    const fields = validateOfferInput(input);
    const now = deps.clock.now();
    return auditDeniedOnLock(deps, actor, context, "CREATE_OFFER", () =>
      deps.withTransaction(async (trx) => {
        const professional = await deps.profileRepo.findByIdForUpdate(trx, actor.professionalId);
        if (!professional) throw new NotFoundError();
        assertCanWrite(professional.validationStatus, "EDIT_COMMERCIAL");
        // A especialidade tem de ser UMA DAS DO PRÓPRIO profissional (a FK composta também o garante) e estar ativa no catálogo.
        const own = (await deps.profileRepo.listSpecialties(trx, professional.id)).find((s) => s.id === fields.specialtyId);
        if (!own?.active) {
          throw new ValidationError([{ field: "specialtyId", message: "tem de ser uma especialidade ativa do profissional" }], { detail: "Oferta inválida." });
        }
        if (await deps.offerRepo.existsActiveDuplicate(trx, professional.id, fields)) throw new ConflictError({ detail: DUPLICATE });
        if ((await deps.offerRepo.countActive(trx, professional.id)) >= MAX_ACTIVE_OFFERS) {
          throw new DomainError("LIMIT_EXCEEDED", { detail: `Máximo de ${String(MAX_ACTIVE_OFFERS)} ofertas ativas.` });
        }
        const created = await deps.offerRepo.insert(trx, { id: newId(), professionalId: professional.id, ...fields, createdAt: now });
        if (!created) throw new ConflictError({ detail: DUPLICATE });
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "PROFESSIONAL_ACCOUNT",
          actorProfessionalAccountId: actor.professionalAccountId,
          action: "PROFESSIONAL_OFFER_CREATE",
          resourceType: "ProfessionalOffer",
          resourceId: created.id,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { active: true },
          ...auditContextFields(context),
        });
        return created;
      }),
    );
  };
}

export function createUpdateOfferUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function updateOffer(actor: ProfessionalActor, offerId: string, input: Record<string, unknown>, context: RequestContext): Promise<OfferRecord> {
    const patch = validateOfferPatch(input);
    const now = deps.clock.now();
    return auditDeniedOnLock(deps, actor, context, "UPDATE_OFFER", () =>
      deps.withTransaction(async (trx) => {
        const professional = await deps.profileRepo.findByIdForUpdate(trx, actor.professionalId);
        if (!professional) throw new NotFoundError();
        // Recurso de outro profissional ou inexistente ⇒ 404 (antes do estado: sem enumeração).
        const offer = await deps.offerRepo.findOwned(trx, professional.id, offerId, { forUpdate: true });
        if (!offer) throw new NotFoundError();
        assertCanWrite(professional.validationStatus, "EDIT_COMMERCIAL");
        const reactivating = patch.active === true && !offer.active;
        if (reactivating) {
          // Reativar equivale a uma nova escolha: a especialidade tem de continuar ativa no catálogo (BR-MKT-22).
          const own = (await deps.profileRepo.listSpecialties(trx, professional.id)).find((s) => s.id === offer.specialtyId);
          if (!own?.active) {
            throw new ValidationError([{ field: "active", message: "a especialidade da oferta está inativa" }], { detail: "Oferta inválida." });
          }
          if (await deps.offerRepo.existsActiveDuplicate(trx, professional.id, offer, offer.id)) throw new ConflictError({ detail: DUPLICATE });
          if ((await deps.offerRepo.countActive(trx, professional.id)) >= MAX_ACTIVE_OFFERS) {
            throw new DomainError("LIMIT_EXCEEDED", { detail: `Máximo de ${String(MAX_ACTIVE_OFFERS)} ofertas ativas.` });
          }
        }
        await deps.offerRepo.update(trx, offer.id, patch, now);
        if (patch.active !== undefined && patch.active !== offer.active) {
          await deps.offerSlotSync.onActiveChanged(trx, professional.id, offer.id, patch.active, now);
        }
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "PROFESSIONAL_ACCOUNT",
          actorProfessionalAccountId: actor.professionalAccountId,
          action: "PROFESSIONAL_OFFER_UPDATE",
          resourceType: "ProfessionalOffer",
          resourceId: offer.id,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { fields: Object.keys(patch).join(","), active: patch.active ?? offer.active },
          ...auditContextFields(context),
        });
        const updated = await deps.offerRepo.findOwned(trx, professional.id, offer.id);
        if (!updated) throw new NotFoundError();
        return updated;
      }),
    );
  };
}
