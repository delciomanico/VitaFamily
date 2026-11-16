// UC-MKT-03 (catálogo ativo para o portal) e UC-MKT-07 (gestão do catálogo pelo Platform Admin). BR-MKT-02/22: nome único sem distinção de
// maiúsculas, categoria imutável com profissionais a usar, desativar em vez de apagar. Auditoria na mesma transação (audit.md regra 3).
import { ConflictError, ForbiddenError, NotFoundError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { validateSpecialtyInput, validateSpecialtyPatch, type SpecialtyCategory } from "../domain/specialty.js";
import type { ProfessionalsDeps, RequestContext, SpecialtyChanges } from "./ports.js";

/** Ator de administração (`platform/actor`): só o Platform Admin gere o catálogo. */
export interface SpecialtyActor {
  userId: string;
  platformAdmin: boolean;
}

export interface PortalSpecialty {
  id: string;
  name: string;
  category: SpecialtyCategory;
}

export interface AdminSpecialty extends PortalSpecialty {
  active: boolean;
  professionalCount: number;
}

export interface SpecialtyCreateInput {
  name: string;
  category: string;
}

export interface SpecialtyUpdateInput {
  name?: string;
  category?: string;
  active?: boolean;
}

const DUPLICATE_NAME = "Já existe uma especialidade com este nome.";
const CATEGORY_IN_USE = "A categoria não pode mudar enquanto houver profissionais a usar a especialidade.";

/** Antes de qualquer acesso à BD (requisito da tarefa e de authorization.md). */
function assertPlatformAdmin(actor: SpecialtyActor): void {
  if (!actor.platformAdmin) {
    throw new ForbiddenError({ detail: "Apenas o administrador da plataforma." });
  }
}

export function createListPortalSpecialtiesUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function listPortalSpecialties(): Promise<PortalSpecialty[]> {
    const rows = await deps.specialtyRepo.list(deps.db, { activeOnly: true });
    return rows.map((row) => ({ id: row.id, name: row.name, category: row.category }));
  };
}

export function createAdminListSpecialtiesUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function adminListSpecialties(actor: SpecialtyActor): Promise<AdminSpecialty[]> {
    assertPlatformAdmin(actor);
    return deps.specialtyRepo.list(deps.db, { activeOnly: false });
  };
}

export function createAdminCreateSpecialtyUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function adminCreateSpecialty(actor: SpecialtyActor, input: SpecialtyCreateInput, context: RequestContext): Promise<AdminSpecialty> {
    assertPlatformAdmin(actor);
    const fields = validateSpecialtyInput(input);
    const now = deps.clock.now();

    return deps.withTransaction(async (trx) => {
      if (await deps.specialtyRepo.existsByNameLower(trx, fields.name)) {
        throw new ConflictError({ detail: DUPLICATE_NAME });
      }
      const id = newId();
      // `null` também na corrida: a violação de `specialties_name_lower_uq` é absorvida pelo `ON CONFLICT DO NOTHING` do repositório.
      const created = await deps.specialtyRepo.insert(trx, { id, name: fields.name, category: fields.category, createdAt: now });
      if (!created) {
        throw new ConflictError({ detail: DUPLICATE_NAME });
      }
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "PLATFORM_ADMIN",
        actorUserId: actor.userId,
        action: "ADMIN_SPECIALTY_CREATE",
        resourceType: "Specialty",
        resourceId: created.id,
        result: "SUCCESS",
        requestId: context.requestId,
        metadata: { category: created.category },
        ...auditContextFields(context),
      });
      return { id: created.id, name: created.name, category: created.category, active: created.active, professionalCount: 0 };
    });
  };
}

export function createAdminUpdateSpecialtyUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function adminUpdateSpecialty(actor: SpecialtyActor, specialtyId: string, input: SpecialtyUpdateInput, context: RequestContext): Promise<AdminSpecialty> {
    assertPlatformAdmin(actor);
    const patch = validateSpecialtyPatch(input);
    const now = deps.clock.now();

    return deps.withTransaction(async (trx) => {
      const current = await deps.specialtyRepo.findByIdForUpdate(trx, specialtyId);
      if (!current) {
        throw new NotFoundError();
      }
      const professionalCount = await deps.specialtyRepo.countProfessionals(trx, specialtyId);
      if (patch.category !== undefined && patch.category !== current.category && professionalCount > 0) {
        throw new ConflictError({ detail: CATEGORY_IN_USE });
      }
      if (patch.name !== undefined && (await deps.specialtyRepo.existsByNameLower(trx, patch.name, specialtyId))) {
        throw new ConflictError({ detail: DUPLICATE_NAME });
      }

      const changes: SpecialtyChanges = { updatedAt: now };
      if (patch.name !== undefined) changes.name = patch.name;
      if (patch.category !== undefined) changes.category = patch.category;
      if (patch.active !== undefined) changes.active = patch.active;
      await deps.specialtyRepo.update(trx, specialtyId, changes);

      // Só os NOMES dos campos vão para a auditoria: nunca o nome da especialidade (BR-HLT-05 / audit.md regra 2).
      const fields = (["name", "category", "active"] as const).filter((key) => patch[key] !== undefined).join(",");
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "PLATFORM_ADMIN",
        actorUserId: actor.userId,
        action: "ADMIN_SPECIALTY_UPDATE",
        resourceType: "Specialty",
        resourceId: specialtyId,
        result: "SUCCESS",
        requestId: context.requestId,
        metadata: { fields },
        ...auditContextFields(context),
      });

      return {
        id: current.id,
        name: patch.name ?? current.name,
        category: patch.category ?? current.category,
        active: patch.active ?? current.active,
        professionalCount,
      };
    });
  };
}
