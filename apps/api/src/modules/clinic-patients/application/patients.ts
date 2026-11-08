// Casos de uso do registo de pacientes da clínica (UC-CLN-14, BR-CLN-17/22, endpoints.md
// `/clinic-portal/patients*`). Autenticados pelo ator de clínica (ambos os papéis, authorization.md §6.2);
// o isolamento é `clinic_id` do token em todas as consultas (404 sem enumeração). Auditoria SEM dados
// pessoais: `CLINIC_PATIENT_CREATE/UPDATE` só com `origin` e nomes de campos.
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import {
  buildSearchTerms,
  decodeCursor,
  encodeCursor,
  isoDateOf,
  normalizeSearchText,
  parsePatientInput,
  parsePatientPatch,
  parseSearchQuery,
  phoneDigits,
} from "../domain/clinic-patient.js";
import { doctorPatientIds, isDoctor } from "./doctor-scope.js";
import type { ClinicPatientsDeps, ClinicPortalActor, PatientChanges, RequestContext } from "./ports.js";
import { enforceSearchRateLimit, requireOwnPatient, toPatientView, toPatientViews, type ClinicPatientView } from "./support.js";

export function createCreateClinicPatientUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function createClinicPatient(actor: ClinicPortalActor, input: Record<string, unknown>, context: RequestContext): Promise<ClinicPatientView> {
    const now = deps.clock.now();
    const draft = parsePatientInput(input, isoDateOf(now));
    return deps.withTransaction(async (trx) => {
      const patient = await deps.patientsRepo.insert(trx, {
        id: newId(),
        clinicId: actor.clinicId,
        name: draft.name,
        nameNorm: normalizeSearchText(draft.name),
        phone: draft.phone,
        phoneDigits: draft.phone ? phoneDigits(draft.phone) : null,
        email: draft.email,
        birthDate: draft.birthDate,
        notes: draft.notes,
        origin: "MANUAL",
        createdByClinicAccountId: actor.clinicAccountId,
        createdAt: now,
      });
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        action: "CLINIC_PATIENT_CREATE",
        resourceType: "ClinicPatient",
        resourceId: patient.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { origin: "MANUAL" },
      });
      return toPatientView(deps, trx, actor.clinicId, patient);
    });
  };
}

export function createUpdateClinicPatientUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function updateClinicPatient(actor: ClinicPortalActor, patientId: string, input: Record<string, unknown>, context: RequestContext): Promise<ClinicPatientView> {
    const now = deps.clock.now();
    const draft = parsePatientPatch(input, isoDateOf(now));
    return deps.withTransaction(async (trx) => {
      const existing = await requireOwnPatient(deps, trx, actor, patientId);
      const changes: PatientChanges = { ...draft };
      if (draft.name !== undefined) changes.nameNorm = normalizeSearchText(draft.name);
      if (draft.phone !== undefined) changes.phoneDigits = draft.phone ? phoneDigits(draft.phone) : null;
      const patient = await deps.patientsRepo.update(trx, actor.clinicId, existing.id, changes, now);
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        action: "CLINIC_PATIENT_UPDATE",
        resourceType: "ClinicPatient",
        resourceId: patient.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        // Só os NOMES dos campos alterados (audit.md): nunca os valores.
        metadata: { origin: patient.origin, fields: Object.keys(draft).sort().join(",") },
      });
      return toPatientView(deps, trx, actor.clinicId, patient);
    });
  };
}

export function createGetClinicPatientUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function getClinicPatient(actor: ClinicPortalActor, patientId: string): Promise<ClinicPatientView> {
    return deps.withTransaction(async (trx) => toPatientView(deps, trx, actor.clinicId, await requireOwnPatient(deps, trx, actor, patientId)));
  };
}

export interface ListClinicPatientsQuery {
  q?: unknown;
  limit?: number;
  cursor?: string;
}

export interface ClinicPatientPageView {
  items: ClinicPatientView[];
  nextCursor: string | null;
}

/** `GET /clinic-portal/patients` (BR-CLN-22): lista/pesquisa só o registo da clínica, por nome, com cursor. Não auditada. */
export function createListClinicPatientsUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function listClinicPatients(actor: ClinicPortalActor, query: ListClinicPatientsQuery): Promise<ClinicPatientPageView> {
    const q = parseSearchQuery(query.q, false);
    const limit = query.limit ?? 25;
    const after = query.cursor ? decodeCursor(query.cursor) : undefined;
    enforceSearchRateLimit(deps, actor);
    return deps.withTransaction(async (trx) => {
      const ids = isDoctor(actor) ? await doctorPatientIds(deps, trx, actor) : undefined;
      const rows = await deps.patientsRepo.list(trx, actor.clinicId, { ...(ids ? { ids } : {}), ...(q ? { terms: buildSearchTerms(q) } : {}), ...(after ? { after } : {}) }, limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const nextCursor = rows.length > limit && last ? encodeCursor({ n: normalizeSearchText(last.name), i: last.id }) : null;
      return { items: await toPatientViews(deps, trx, actor.clinicId, page), nextCursor };
    });
  };
}
