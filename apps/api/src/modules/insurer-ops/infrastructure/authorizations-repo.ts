// Implementação Kysely de `AuthorizationsRepository` (marco B fatia 3, schema.md §3c, migração 0039). Sem regras de negócio:
// a máquina, os prazos e a projeção de cobertura vivem em `domain/`. Toda consulta filtra por `insurer_id` ou pelo prestador
// da clínica (BR-SEG-14). Nenhuma coluna clínica existe (C2).
import { sql, type Kysely, type SelectQueryBuilder } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type {
  AuthorizationListFilter,
  AuthorizationsRepository,
  AuthorizationStatusChange,
  NewAttachmentRecord,
  NewAuthorizationEvent,
  NewAuthorizationRecord,
  PageQuery,
} from "../application/ports.js";
import type { Authorization, AuthorizationAttachment, AuthorizationEvent, AuthorizationRow } from "../domain/authorization.js";
import { PENDING_STATUSES } from "../domain/authorization-machine.js";
import { projectCoverage, type CoverageFact } from "../domain/coverage-phase.js";
import type { CoverageLine } from "../domain/coverage.js";
import { guard, keyset } from "./db-helpers.js";
import "./schema.js";

type Db = Kysely<Database>;

const DUPLICATE_DETAIL = "Já existe um pedido em curso para este beneficiário, serviço e data.";

const toMinor = (value: string | null): number | null => (value === null ? null : Math.round(Number(value) * 100));

function rowOf(r: {
  id: string;
  insurer_id: string;
  beneficiary_id: string;
  provider_id: string;
  service_id: string;
  guide_type: string;
  process_id: string | null;
  parent_request_id: string | null;
  status: Authorization["status"];
  closed_reason: Authorization["closedReason"];
  justification: string;
  requested_amount: string;
  authorized_amount: string | null;
  expected_on: string;
  code: string | null;
  valid_until: Date | null;
  decision_note: string | null;
  decided_at: Date | null;
  decision_due_at: Date;
  info_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  beneficiary_name: string;
  service_code: string;
  service_name: string;
  has_live_appeal: boolean;
}): AuthorizationRow {
  return {
    id: r.id,
    insurerId: r.insurer_id,
    beneficiaryId: r.beneficiary_id,
    providerId: r.provider_id,
    serviceId: r.service_id,
    guideType: r.guide_type,
    processId: r.process_id,
    parentRequestId: r.parent_request_id,
    status: r.status,
    closedReason: r.closed_reason,
    justification: r.justification,
    requestedAmount: Number(r.requested_amount),
    authorizedAmount: r.authorized_amount === null ? null : Number(r.authorized_amount),
    expectedOn: r.expected_on,
    code: r.code,
    validUntil: r.valid_until,
    decisionNote: r.decision_note,
    decidedAt: r.decided_at,
    decisionDueAt: r.decision_due_at,
    infoExpiresAt: r.info_expires_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    beneficiaryName: r.beneficiary_name,
    serviceCode: r.service_code,
    serviceName: r.service_name,
    hasLiveAppeal: r.has_live_appeal,
  };
}

/** Pedido + nome do beneficiário, serviço e se tem recurso vivo; restrito ao prestador da clínica (BR-AUT-11). */
function baseQuery(trx: Db, clinicId: string) {
  return trx
    .selectFrom("insurer_authorizations as a")
    .innerJoin("insurer_providers as p", (join) => join.onRef("p.insurer_id", "=", "a.insurer_id").onRef("p.id", "=", "a.provider_id"))
    .innerJoin("insurer_beneficiaries as b", (join) => join.onRef("b.insurer_id", "=", "a.insurer_id").onRef("b.id", "=", "a.beneficiary_id"))
    .innerJoin("insurer_services as s", (join) => join.onRef("s.insurer_id", "=", "a.insurer_id").onRef("s.id", "=", "a.service_id"))
    .select([
      "a.id",
      "a.insurer_id",
      "a.beneficiary_id",
      "a.provider_id",
      "a.service_id",
      "a.guide_type",
      "a.process_id",
      "a.parent_request_id",
      "a.status",
      "a.closed_reason",
      "a.justification",
      "a.requested_amount",
      "a.authorized_amount",
      "a.expected_on",
      "a.code",
      "a.valid_until",
      "a.decision_note",
      "a.decided_at",
      "a.decision_due_at",
      "a.info_expires_at",
      "a.created_at",
      "a.updated_at",
      "b.name as beneficiary_name",
      "s.code as service_code",
      "s.name as service_name",
      sql<boolean>`exists (select 1 from insurer_authorizations c where c.insurer_id = a.insurer_id and c.parent_request_id = a.id and c.status <> 'CANCELLED')`.as("has_live_appeal"),
    ])
    .where("p.clinic_id", "=", clinicId);
}

export class KyselyAuthorizationsRepository implements AuthorizationsRepository<Db> {
  async linkOfBeneficiary(trx: Db, insurerId: string, beneficiaryId: string): Promise<{ familyId: string; memberId: string } | null> {
    const row = await trx.selectFrom("insurer_beneficiaries").select(["family_id", "family_member_id"]).where("insurer_id", "=", insurerId).where("id", "=", beneficiaryId).executeTakeFirst();
    return row?.family_id && row.family_member_id ? { familyId: row.family_id, memberId: row.family_member_id } : null;
  }

  async activeProviderId(trx: Db, clinicId: string, insurerId: string): Promise<string | null> {
    const row = await trx.selectFrom("insurer_providers").select("id").where("clinic_id", "=", clinicId).where("insurer_id", "=", insurerId).where("status", "=", "ACTIVE").executeTakeFirst();
    return row?.id ?? null;
  }

  async findServiceByCode(trx: Db, insurerId: string, code: string): Promise<{ id: string; status: "ACTIVE" | "INACTIVE"; guideType: string | null; serviceKindId: string | null } | null> {
    const row = await trx
      .selectFrom("insurer_services as s")
      .leftJoin("insurer_service_kinds as k", (join) => join.onRef("k.insurer_id", "=", "s.insurer_id").onRef("k.id", "=", "s.service_kind_id"))
      .select(["s.id", "s.status", "s.service_kind_id", "k.guide_type"])
      .where("s.insurer_id", "=", insurerId)
      .where("s.code", "=", code)
      .executeTakeFirst();
    return row ? { id: row.id, status: row.status, guideType: row.guide_type, serviceKindId: row.service_kind_id } : null;
  }

  async planCoverageLines(trx: Db, insurerId: string, planId: string): Promise<CoverageLine[]> {
    const rows = await trx
      .selectFrom("insurer_plan_coverages")
      .select(["service_id", "type", "copay_pct", "limit_per_year", "waiting_days", "requires_authorization"])
      .where("insurer_id", "=", insurerId)
      .where("plan_id", "=", planId)
      .execute();
    return rows.map((r) => ({ serviceId: r.service_id, type: r.type, copayPct: Number(r.copay_pct), limitPerYearMinor: toMinor(r.limit_per_year), waitingDays: r.waiting_days, requiresAuthorization: r.requires_authorization }));
  }

  async activeGuideTypes(trx: Db): Promise<string[]> {
    return (await trx.selectFrom("guide_types").select("code").where("active", "=", true).orderBy("sort_order").execute()).map((r) => r.code);
  }

  async insert(trx: Db, record: NewAuthorizationRecord): Promise<void> {
    await guard(
      () =>
        trx
          .insertInto("insurer_authorizations")
          .values({
            id: record.id,
            insurer_id: record.insurerId,
            beneficiary_id: record.beneficiaryId,
            provider_id: record.providerId,
            service_id: record.serviceId,
            guide_type: record.guideType,
            process_id: record.processId,
            parent_request_id: record.parentRequestId,
            status: record.status,
            justification: record.justification,
            requested_amount: record.requestedAmount,
            expected_on: record.expectedOn,
            decision_due_at: record.decisionDueAt,
            submitted_by_clinic_account_id: record.submittedByClinicAccountId,
            // Auto-aprovação (BR-AUT-03): nasce APPROVED com decisor SYSTEM, código e validade (CHECK `approved_check`).
            ...(record.autoApproval
              ? { authorized_amount: record.autoApproval.authorizedAmount, code: record.autoApproval.code, valid_until: record.autoApproval.validUntil, decided_by_kind: "SYSTEM" as const, decided_at: record.now }
              : {}),
            auto_approval_trace: record.autoApprovalTrace === null ? null : JSON.stringify(record.autoApprovalTrace),
            created_at: record.now,
            updated_at: record.now,
          })
          .execute(),
      DUPLICATE_DETAIL,
    );
  }

  async insertEvent(trx: Db, event: NewAuthorizationEvent): Promise<void> {
    await trx
      .insertInto("insurer_authorization_events")
      .values({
        insurer_id: event.insurerId,
        authorization_id: event.authorizationId,
        from_status: event.from,
        to_status: event.to,
        actor_type: event.actorType,
        actor_account_id: event.actorAccountId,
        channel: event.channel,
        note: event.note,
        actor_role: event.actorRole ?? null,
        internal_note: event.internalNote ?? null,
        occurred_at: event.at,
      })
      .execute();
  }

  async findForClinic(trx: Db, clinicId: string, id: string, lock = false): Promise<AuthorizationRow | null> {
    let query = baseQuery(trx, clinicId).where("a.id", "=", id);
    // `FOR UPDATE` só nas linhas do pedido (as outras tabelas são só leitura).
    if (lock) query = query.modifyEnd(sql`for update of a`);
    const row = await query.executeTakeFirst();
    return row ? rowOf(row) : null;
  }

  async listForClinic(trx: Db, clinicId: string, filter: AuthorizationListFilter, page: PageQuery): Promise<AuthorizationRow[]> {
    let query = baseQuery(trx, clinicId);
    if (filter.insurerId) query = query.where("a.insurer_id", "=", filter.insurerId);
    if (filter.processId) query = query.where("a.process_id", "=", filter.processId);
    if (filter.status === "OPEN") query = query.where("a.status", "in", [...PENDING_STATUSES]);
    else if (filter.status) query = query.where("a.status", "=", filter.status);
    return (await keyset(query as unknown as SelectQueryBuilder<Database, "insurer_authorizations", Record<string, never>>, "a", page).execute()).map((r) => rowOf(r as never));
  }

  async updateStatus(trx: Db, insurerId: string, id: string, change: AuthorizationStatusChange): Promise<void> {
    await trx
      .updateTable("insurer_authorizations")
      .set({
        status: change.status,
        closed_reason: change.closedReason,
        info_expires_at: change.infoExpiresAt,
        updated_at: change.now,
        // Prazo recalculado ⇒ a marca de escalada limpa-se (BR-AUT-20).
        ...(change.decisionDueAt ? { decision_due_at: change.decisionDueAt, escalated_at: null } : {}),
      })
      .where("insurer_id", "=", insurerId)
      .where("id", "=", id)
      .execute();
  }

  async events(trx: Db, authorizationIds: string[]): Promise<Map<string, AuthorizationEvent[]>> {
    const result = new Map<string, AuthorizationEvent[]>();
    if (authorizationIds.length === 0) return result;
    const rows = await trx
      .selectFrom("insurer_authorization_events")
      .select(["authorization_id", "to_status", "actor_type", "note", "occurred_at"])
      .where("authorization_id", "in", authorizationIds)
      .orderBy("id")
      .execute();
    for (const r of rows) {
      const list = result.get(r.authorization_id) ?? [];
      list.push({ toStatus: r.to_status, actorType: r.actor_type, note: r.note, occurredAt: r.occurred_at });
      result.set(r.authorization_id, list);
    }
    return result;
  }

  async attachments(trx: Db, authorizationIds: string[]): Promise<Map<string, AuthorizationAttachment[]>> {
    const result = new Map<string, AuthorizationAttachment[]>();
    if (authorizationIds.length === 0) return result;
    const rows = await trx
      .selectFrom("insurer_attachments")
      .select(["id", "authorization_id", "kind", "original_name", "mime_type", "size_bytes", "uploaded_by_clinic_account_id", "created_at"])
      .where("authorization_id", "in", authorizationIds)
      .orderBy("created_at")
      .orderBy("id")
      .execute();
    for (const r of rows) {
      const list = result.get(r.authorization_id) ?? [];
      list.push({
        id: r.id,
        authorizationId: r.authorization_id,
        kind: r.kind,
        originalName: r.original_name,
        mimeType: r.mime_type,
        sizeBytes: Number(r.size_bytes),
        uploadedByClinicAccountId: r.uploaded_by_clinic_account_id,
        createdAt: r.created_at,
      });
      result.set(r.authorization_id, list);
    }
    return result;
  }

  async countAttachments(trx: Db, insurerId: string, authorizationId: string): Promise<number> {
    const row = await trx.selectFrom("insurer_attachments").select(sql<string>`count(*)`.as("n")).where("insurer_id", "=", insurerId).where("authorization_id", "=", authorizationId).executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async insertAttachment(trx: Db, record: NewAttachmentRecord): Promise<AuthorizationAttachment> {
    await trx
      .insertInto("insurer_attachments")
      .values({
        id: record.id,
        insurer_id: record.insurerId,
        authorization_id: record.authorizationId,
        kind: record.kind,
        storage_key: record.storageKey,
        original_name: record.originalName,
        mime_type: record.mimeType,
        size_bytes: record.sizeBytes,
        checksum_sha256: record.checksumSha256,
        uploaded_by_clinic_account_id: record.uploadedByClinicAccountId,
        created_at: record.createdAt,
      })
      .execute();
    return {
      id: record.id,
      authorizationId: record.authorizationId,
      kind: record.kind,
      originalName: record.originalName,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      uploadedByClinicAccountId: record.uploadedByClinicAccountId,
      createdAt: record.createdAt,
    };
  }

  async findAttachment(trx: Db, insurerId: string, authorizationId: string, attachmentId: string): Promise<(AuthorizationAttachment & { storageKey: string }) | null> {
    const r = await trx
      .selectFrom("insurer_attachments")
      .select(["id", "authorization_id", "kind", "original_name", "mime_type", "size_bytes", "uploaded_by_clinic_account_id", "created_at", "storage_key"])
      .where("insurer_id", "=", insurerId)
      .where("authorization_id", "=", authorizationId)
      .where("id", "=", attachmentId)
      .executeTakeFirst();
    return r
      ? {
          id: r.id,
          authorizationId: r.authorization_id,
          kind: r.kind,
          originalName: r.original_name,
          mimeType: r.mime_type,
          sizeBytes: Number(r.size_bytes),
          uploadedByClinicAccountId: r.uploaded_by_clinic_account_id,
          createdAt: r.created_at,
          storageKey: r.storage_key,
        }
      : null;
  }

  async deleteAttachment(trx: Db, insurerId: string, attachmentId: string): Promise<void> {
    await trx.deleteFrom("insurer_attachments").where("insurer_id", "=", insurerId).where("id", "=", attachmentId).execute();
  }

  async lockExpiredInfoRequests(trx: Db, now: Date, limit: number): Promise<{ id: string; insurerId: string }[]> {
    const rows = await trx
      .selectFrom("insurer_authorizations")
      .select(["id", "insurer_id"])
      .where("status", "=", "INFO_REQUESTED")
      .where("info_expires_at", "<=", now)
      .orderBy("info_expires_at")
      .orderBy("id")
      .limit(limit)
      .forUpdate()
      .skipLocked()
      .execute();
    return rows.map((r) => ({ id: r.id, insurerId: r.insurer_id }));
  }

  async coverageFacts(trx: Db, processIds: string[], now: Date): Promise<{ processId: string; fact: CoverageFact }[]> {
    if (processIds.length === 0) return [];
    const rows = await trx
      .selectFrom("insurer_authorizations")
      .select(["id", "process_id", "parent_request_id", "status", "closed_reason", "decision_due_at", "valid_until", "requested_amount", "authorized_amount", "updated_at"])
      .where("process_id", "in", processIds)
      .execute();
    const byProcess = new Map<string, typeof rows>();
    for (const r of rows) {
      if (r.process_id === null) continue;
      byProcess.set(r.process_id, [...(byProcess.get(r.process_id) ?? []), r]);
    }
    const facts: { processId: string; fact: CoverageFact }[] = [];
    for (const [processId, requests] of byProcess) {
      const fact = projectCoverage(requests.map((r) => ({ id: r.id, parentRequestId: r.parent_request_id, status: r.status, closedReason: r.closed_reason, decisionDueAt: r.decision_due_at, validUntil: r.valid_until, requestedAmount: Number(r.requested_amount), authorizedAmount: r.authorized_amount === null ? null : Number(r.authorized_amount), updatedAt: r.updated_at })), now);
      if (fact !== undefined) facts.push({ processId, fact });
    }
    return facts;
  }
}
