// Implementação Kysely de `InsurerAuthorizationsRepository` (marco B fatia 4, schema.md §3c, migração 0040): o lado da SEGURADORA
// do pedido. Sem regras de negócio (a máquina, a matriz de ações, o SLA e a validade vivem em `domain/`). Toda consulta filtra por
// `insurer_id` (BR-SEG-14). Nenhuma coluna clínica nem id de utilizador/família/membro sai daqui (C2).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { DecisionWrite, ExpiringApproval, InsurerAuthorizationsRepository, AuthorizationAssignee, QueuePage } from "../application/ports.js";
import type { AutoApprovalTrace } from "../domain/auto-approval.js";
import type { AuthorizationStatus } from "../domain/authorization-machine.js";
import type { InsurerAuthorizationEventRow, InsurerAuthorizationRow, InsurerQueueFilter, SlaMetricsCounts } from "../domain/insurer-authorization.js";
import { PENDING_STATUSES } from "../domain/authorization-machine.js";
import { guard } from "./db-helpers.js";
import "./schema.js";

type Db = Kysely<Database>;

function baseQuery(trx: Db, insurerId: string) {
  return trx
    .selectFrom("insurer_authorizations as a")
    .innerJoin("insurer_providers as p", (join) => join.onRef("p.insurer_id", "=", "a.insurer_id").onRef("p.id", "=", "a.provider_id"))
    .innerJoin("insurer_beneficiaries as b", (join) => join.onRef("b.insurer_id", "=", "a.insurer_id").onRef("b.id", "=", "a.beneficiary_id"))
    .innerJoin("insurer_services as s", (join) => join.onRef("s.insurer_id", "=", "a.insurer_id").onRef("s.id", "=", "a.service_id"))
    .leftJoin("insurance_accounts as ac", "ac.id", "a.assigned_to_insurance_account_id")
    .select([
      "a.id",
      "a.insurer_id",
      "a.beneficiary_id",
      "a.service_id",
      "a.guide_type",
      "a.parent_request_id",
      "a.process_id",
      "a.status",
      "a.closed_reason",
      "a.justification",
      "a.requested_amount",
      "a.authorized_amount",
      "a.expected_on",
      "a.code",
      "a.valid_until",
      "a.decision_note",
      "a.decided_by_kind",
      "a.decided_by_insurance_account_id",
      "a.decided_at",
      "a.decision_due_at",
      "a.info_expires_at",
      "a.escalated_at",
      "a.assigned_to_insurance_account_id",
      "a.auto_approval_trace",
      "a.created_at",
      "a.updated_at",
      "b.name as beneficiary_name",
      "p.name as provider_name",
      "s.code as service_code",
      "s.name as service_name",
      "s.service_kind_id",
      "s.status as service_status",
      "ac.email as assigned_email",
      sql<boolean>`exists (select 1 from insurer_authorizations c where c.insurer_id = a.insurer_id and c.parent_request_id = a.id and c.status <> 'CANCELLED')`.as("has_live_appeal"),
      sql<string | null>`(select o.decided_by_insurance_account_id from insurer_authorizations o where o.insurer_id = a.insurer_id and o.id = a.parent_request_id)`.as("origin_decider"),
      sql<string | null>`(select e.actor_account_id from insurer_authorization_events e where e.insurer_id = a.insurer_id and e.authorization_id = a.id and e.to_status = 'REJECTED' order by e.id desc limit 1)`.as("prior_rejecter"),
    ])
    .where("a.insurer_id", "=", insurerId);
}

type Raw = Awaited<ReturnType<ReturnType<typeof baseQuery>["executeTakeFirstOrThrow"]>>;

function toRow(r: Raw): InsurerAuthorizationRow {
  return {
    id: r.id,
    insurerId: r.insurer_id,
    beneficiaryId: r.beneficiary_id,
    beneficiaryName: r.beneficiary_name,
    providerName: r.provider_name,
    serviceId: r.service_id,
    serviceCode: r.service_code,
    serviceName: r.service_name,
    serviceKindId: r.service_kind_id,
    serviceStatus: r.service_status,
    guideType: r.guide_type,
    status: r.status,
    closedReason: r.closed_reason,
    justification: r.justification,
    requestedAmount: Number(r.requested_amount),
    authorizedAmount: r.authorized_amount === null ? null : Number(r.authorized_amount),
    expectedOn: r.expected_on,
    parentRequestId: r.parent_request_id,
    processId: r.process_id,
    decisionNote: r.decision_note,
    code: r.code,
    validUntil: r.valid_until,
    decisionDueAt: r.decision_due_at,
    infoExpiresAt: r.info_expires_at,
    escalatedAt: r.escalated_at,
    assignedTo: r.assigned_to_insurance_account_id !== null && r.assigned_email !== null ? { id: r.assigned_to_insurance_account_id, email: r.assigned_email } : null,
    decidedByKind: r.decided_by_kind,
    decidedByAccountId: r.decided_by_insurance_account_id,
    decidedAt: r.decided_at,
    autoApprovalTrace: r.auto_approval_trace === null || r.auto_approval_trace === undefined ? null : (r.auto_approval_trace as AutoApprovalTrace),
    hasLiveAppeal: r.has_live_appeal,
    originDeciderAccountId: r.origin_decider,
    priorRejecterAccountId: r.prior_rejecter,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class KyselyInsurerAuthorizationsRepository implements InsurerAuthorizationsRepository<Db> {
  async list(trx: Db, insurerId: string, filter: InsurerQueueFilter, page: QueuePage): Promise<InsurerAuthorizationRow[]> {
    let query = baseQuery(trx, insurerId);
    query = filter.status === "OPEN" ? query.where("a.status", "in", PENDING_STATUSES.filter((s) => s !== "SUBMITTED")) : query.where("a.status", "=", filter.status);
    if (filter.assigned === "ME") query = query.where("a.assigned_to_insurance_account_id", "=", filter.accountId);
    else if (filter.assigned === "UNASSIGNED") query = query.where("a.assigned_to_insurance_account_id", "is", null);
    if (filter.overdue === true) query = query.where("a.status", "=", "IN_REVIEW").where("a.decision_due_at", "<=", filter.now);
    if (filter.escalated !== undefined) query = query.where("a.escalated_at", filter.escalated ? "is not" : "is", null);
    if (filter.appeal !== undefined) query = query.where("a.parent_request_id", filter.appeal ? "is not" : "is", null);
    if (filter.decidedBy !== undefined) query = query.where("a.decided_by_kind", "=", filter.decidedBy);

    if (filter.sort === "RECENT") {
      if (page.cursor) query = query.where(sql<boolean>`(a.updated_at, a.id) < (${new Date(page.cursor.at)}::timestamptz, ${page.cursor.id}::uuid)`);
      query = query.orderBy(sql`a.updated_at desc`).orderBy(sql`a.id desc`);
    } else {
      if (page.cursor) query = query.where(sql<boolean>`(a.decision_due_at, a.id) > (${new Date(page.cursor.at)}::timestamptz, ${page.cursor.id}::uuid)`);
      query = query.orderBy(sql`a.decision_due_at asc`).orderBy(sql`a.id asc`);
    }
    return (await query.limit(page.limit + 1).execute()).map(toRow);
  }

  async find(trx: Db, insurerId: string, id: string, lock = false): Promise<InsurerAuthorizationRow | null> {
    let query = baseQuery(trx, insurerId).where("a.id", "=", id);
    // `FOR UPDATE` só nas linhas do pedido (as outras tabelas são só leitura): serializa decisões concorrentes (TC-DEC-05).
    if (lock) query = query.modifyEnd(sql`for update of a`);
    const row = await query.executeTakeFirst();
    return row ? toRow(row) : null;
  }

  async events(trx: Db, insurerId: string, authorizationId: string): Promise<InsurerAuthorizationEventRow[]> {
    const rows = await trx
      .selectFrom("insurer_authorization_events")
      .select(["to_status", "actor_type", "actor_role", "note", "internal_note", "occurred_at"])
      .where("insurer_id", "=", insurerId)
      .where("authorization_id", "=", authorizationId)
      .orderBy("id")
      .execute();
    return rows.map((e) => ({ toStatus: e.to_status, actorType: e.actor_type, actorRole: e.actor_role, note: e.note, internalNote: e.internal_note, occurredAt: e.occurred_at }));
  }

  async decide(trx: Db, insurerId: string, id: string, from: AuthorizationStatus, write: DecisionWrite): Promise<boolean> {
    const base = { updated_at: write.now };
    let set: Record<string, unknown>;
    switch (write.kind) {
      case "APPROVE":
        set = {
          ...base,
          status: "APPROVED",
          closed_reason: null,
          info_expires_at: null,
          authorized_amount: write.authorizedAmount,
          code: write.code,
          valid_until: write.validUntil,
          decision_note: write.note,
          decided_by_kind: write.decidedBy,
          decided_by_insurance_account_id: write.accountId,
          decided_at: write.now,
        };
        break;
      case "REJECT":
        set = { ...base, status: "REJECTED", decision_note: write.note, decided_by_kind: write.decidedBy, decided_by_insurance_account_id: write.accountId, decided_at: write.now };
        break;
      case "REQUEST_INFO":
        set = { ...base, status: "INFO_REQUESTED", decision_note: write.note, info_expires_at: write.infoExpiresAt };
        break;
      case "REVERT":
        // Mantém o histórico do que foi decidido (decisor, valor); o código deixa de valer por o estado já não ser APPROVED (BR-AUT-21).
        set = { ...base, status: "CANCELLED", closed_reason: "ANALYST_CANCELLED", decision_note: write.note, info_expires_at: null };
        break;
      case "REOPEN":
        // Limpa a decisão, a atribuição e a marca de escalada; a história fica nos eventos (BR-AUT-22).
        set = {
          ...base,
          status: "IN_REVIEW",
          closed_reason: null,
          decision_due_at: write.decisionDueAt,
          escalated_at: null,
          authorized_amount: null,
          code: null,
          valid_until: null,
          decision_note: null,
          decided_by_kind: null,
          decided_by_insurance_account_id: null,
          decided_at: null,
          assigned_to_insurance_account_id: null,
          assigned_at: null,
        };
        break;
    }
    // O UPDATE é condicionado ao estado de origem (BR-AUT-17): a decisão perdida não escreve nada.
    // Reabrir com outro pedido igual em curso viola o UNIQUE de BR-AUT-09 ⇒ `ConflictError` (409 CONFLICT).
    const result = await guard(
      () =>
        trx
          .updateTable("insurer_authorizations")
          .set(set as never)
          .where("insurer_id", "=", insurerId)
          .where("id", "=", id)
          .where("status", "=", from)
          .executeTakeFirst(),
      "Já existe um pedido em curso ou aprovado para este beneficiário, serviço e data.",
    );
    return Number(result.numUpdatedRows) > 0;
  }

  async assign(trx: Db, insurerId: string, id: string, accountId: string | null, now: Date): Promise<void> {
    await trx
      .updateTable("insurer_authorizations")
      .set({ assigned_to_insurance_account_id: accountId, assigned_at: accountId === null ? null : now })
      .where("insurer_id", "=", insurerId)
      .where("id", "=", id)
      .execute();
  }

  async isActiveAnalyst(trx: Db, insurerId: string, accountId: string): Promise<boolean> {
    const row = await trx.selectFrom("insurance_accounts").select("id").where("insurer_id", "=", insurerId).where("id", "=", accountId).where("role", "=", "AUTHORIZATION_ANALYST").where("status", "=", "ACTIVE").executeTakeFirst();
    return row !== undefined;
  }

  async listAssignees(trx: Db, insurerId: string): Promise<AuthorizationAssignee[]> {
    return trx.selectFrom("insurance_accounts").select(["id", "email"]).where("insurer_id", "=", insurerId).where("role", "=", "AUTHORIZATION_ANALYST").where("status", "=", "ACTIVE").orderBy("email").orderBy("id").execute();
  }

  async metrics(trx: Db, insurerId: string, period: { from: Date; to: Date }, now: Date): Promise<SlaMetricsCounts> {
    const open = await sql<{ total: string; unassigned: string; overdue: string; escalated: string; info_requested: string }>`
      select
        count(*) filter (where status in ('IN_REVIEW', 'INFO_REQUESTED')) as total,
        count(*) filter (where status = 'IN_REVIEW' and assigned_to_insurance_account_id is null and parent_request_id is null) as unassigned,
        count(*) filter (where status = 'IN_REVIEW' and decision_due_at <= ${now}) as overdue,
        count(*) filter (where status = 'IN_REVIEW' and escalated_at is not null) as escalated,
        count(*) filter (where status = 'INFO_REQUESTED') as info_requested
      from insurer_authorizations where insurer_id = ${insurerId}`.execute(trx);
    const decided = await sql<{ decided: string; approved: string; rejected: string; auto_approved: string; within_sla: string; median_hours: string | null }>`
      select
        count(*) as decided,
        count(*) filter (where status = 'APPROVED') as approved,
        count(*) filter (where status = 'REJECTED') as rejected,
        count(*) filter (where status = 'APPROVED' and decided_by_kind = 'SYSTEM') as auto_approved,
        count(*) filter (where decided_at <= decision_due_at) as within_sla,
        percentile_cont(0.5) within group (order by extract(epoch from (decided_at - created_at)) / 3600.0) as median_hours
      from insurer_authorizations
      where insurer_id = ${insurerId} and status in ('APPROVED', 'REJECTED') and decided_at >= ${period.from} and decided_at < ${period.to}`.execute(trx);
    const o = open.rows[0];
    const d = decided.rows[0];
    if (!o || !d) throw new Error("agregados inexistentes");
    return {
      open: { total: Number(o.total), unassigned: Number(o.unassigned), overdue: Number(o.overdue), escalated: Number(o.escalated), infoRequested: Number(o.info_requested) },
      period: {
        decided: Number(d.decided),
        approved: Number(d.approved),
        rejected: Number(d.rejected),
        autoApproved: Number(d.auto_approved),
        decidedWithinSla: Number(d.within_sla),
        medianDecisionHours: d.median_hours === null ? null : Math.round(Number(d.median_hours) * 100) / 100,
      },
    };
  }

  async lockSlaBreaches(trx: Db, now: Date, limit: number): Promise<{ id: string; insurerId: string }[]> {
    const rows = await trx
      .selectFrom("insurer_authorizations")
      .select(["id", "insurer_id"])
      .where("status", "=", "IN_REVIEW")
      .where("decision_due_at", "<=", now)
      .where("escalated_at", "is", null)
      .orderBy("decision_due_at")
      .orderBy("id")
      .limit(limit)
      .forUpdate()
      .skipLocked()
      .execute();
    return rows.map((r) => ({ id: r.id, insurerId: r.insurer_id }));
  }

  async listExpiringApprovals(trx: Db, from: Date, to: Date, limit: number): Promise<ExpiringApproval[]> {
    const rows = await trx
      .selectFrom("insurer_authorizations")
      .select(["id", "process_id", "decided_at", "valid_until"])
      .where("status", "=", "APPROVED")
      .where("process_id", "is not", null)
      .where("valid_until", ">", from)
      .where("valid_until", "<=", to)
      .orderBy("valid_until")
      .orderBy("id")
      .limit(limit)
      .execute();
    return rows.flatMap((r) => (r.process_id === null || r.valid_until === null ? [] : [{ requestId: r.id, processId: r.process_id, decidedAt: r.decided_at, validUntil: r.valid_until }]));
  }

  async markEscalated(trx: Db, insurerId: string, id: string, now: Date): Promise<void> {
    // Marca, não estado: não toca em `updated_at` (não reordena o histórico nem muda `changedAt` do processo).
    await trx.updateTable("insurer_authorizations").set({ escalated_at: now }).where("insurer_id", "=", insurerId).where("id", "=", id).execute();
  }
}
