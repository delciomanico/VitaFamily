// Implementação Kysely do lado do paciente (S6 parcial): cartões e pedidos de ligação de um membro (`family_id`+`family_member_id`;
// FKs compostas na BD). Lê só dados da seguradora; nunca dados de saúde (a única fronteira é a ligação consentida, BR-SEG-20).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { PatientInsuranceRepository, PatientLinkRequest } from "../application/ports.js";
import { guard } from "./db-helpers.js";
import "./schema.js";

type Db = Kysely<Database>;

const toRequest = (r: { id: string; insurer_id: string; beneficiary_id: string; status: PatientLinkRequest["status"]; created_at: Date; decided_at: Date | null; decision_note: string | null }): PatientLinkRequest => ({
  id: r.id,
  insurerId: r.insurer_id,
  // O contrato só mostra o beneficiário depois de CONFIRMED.
  beneficiaryId: r.status === "CONFIRMED" ? r.beneficiary_id : null,
  status: r.status,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
  decisionNote: r.status === "REJECTED" ? r.decision_note : null,
});

const REQUEST_COLUMNS = ["id", "insurer_id", "beneficiary_id", "status", "created_at", "decided_at", "decision_note"] as const;

export class KyselyPatientInsuranceRepository implements PatientInsuranceRepository<Db> {
  async findClaimCandidate(trx: Db, insurerId: string, policyNumber: string, codeHash: string, now: Date): Promise<{ beneficiaryId: string } | null> {
    // A apólice é a do titular do agregado (o titular tem `holder_id` nulo; dependentes apontam para ele).
    const row = await trx
      .selectFrom("insurer_beneficiaries as b")
      .innerJoin("insurer_policies as p", (join) => join.onRef("p.insurer_id", "=", "b.insurer_id").on(sql<boolean>`p.holder_id = coalesce(b.holder_id, b.id)`))
      .select("b.id")
      .where("b.insurer_id", "=", insurerId)
      .where("p.number", "=", policyNumber)
      .where("b.claim_code_hash", "=", codeHash)
      .where("b.claim_code_expires_at", ">", now)
      .where("b.family_member_id", "is", null)
      .where("b.status", "<>", "CANCELLED")
      .limit(1)
      .forUpdate()
      .executeTakeFirst();
    return row ? { beneficiaryId: row.id } : null;
  }

  async consumeClaimCode(trx: Db, insurerId: string, beneficiaryId: string, now: Date): Promise<void> {
    await trx.updateTable("insurer_beneficiaries").set({ claim_code_hash: null, claim_code_expires_at: null, updated_at: now }).where("insurer_id", "=", insurerId).where("id", "=", beneficiaryId).execute();
  }

  async hasPendingOrLinked(trx: Db, insurerId: string, familyId: string, memberId: string): Promise<boolean> {
    const pending = await trx
      .selectFrom("insurer_beneficiary_link_requests")
      .select("id")
      .where("insurer_id", "=", insurerId)
      .where("family_id", "=", familyId)
      .where("family_member_id", "=", memberId)
      .where("status", "=", "PENDING")
      .limit(1)
      .executeTakeFirst();
    if (pending) return true;
    const linked = await trx.selectFrom("insurer_beneficiaries").select("id").where("insurer_id", "=", insurerId).where("family_id", "=", familyId).where("family_member_id", "=", memberId).limit(1).executeTakeFirst();
    return linked !== undefined;
  }

  async insertRequest(trx: Db, record: { id: string; insurerId: string; beneficiaryId: string; requestedBy: string; familyId: string; memberId: string; createdAt: Date }): Promise<void> {
    await guard(
      () =>
        trx
          .insertInto("insurer_beneficiary_link_requests")
          .values({ id: record.id, insurer_id: record.insurerId, beneficiary_id: record.beneficiaryId, requested_by: record.requestedBy, family_id: record.familyId, family_member_id: record.memberId, created_at: record.createdAt, updated_at: record.createdAt })
          .execute(),
      "Já existe um pedido pendente para este cartão.",
    );
  }

  async listRequests(trx: Db, familyId: string, memberId: string): Promise<PatientLinkRequest[]> {
    const rows = await trx
      .selectFrom("insurer_beneficiary_link_requests")
      .select(REQUEST_COLUMNS)
      .where("family_id", "=", familyId)
      .where("family_member_id", "=", memberId)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .execute();
    return rows.map(toRequest);
  }

  async findRequest(trx: Db, familyId: string, memberId: string, requestId: string, lock = false): Promise<PatientLinkRequest | null> {
    let query = trx.selectFrom("insurer_beneficiary_link_requests").select(REQUEST_COLUMNS).where("family_id", "=", familyId).where("family_member_id", "=", memberId).where("id", "=", requestId);
    if (lock) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    if (!row) return null;
    // Com o pedido já bloqueado, a decisão de uma seguradora concorrente (READ COMMITTED) já é visível aqui.
    return toRequest(row);
  }

  async revoke(trx: Db, record: { insurerId: string; requestId: string; beneficiaryId: string; familyId: string; memberId: string; now: Date }): Promise<void> {
    await trx
      .updateTable("insurer_beneficiary_link_requests")
      .set({ status: "REVOKED", updated_at: record.now })
      .where("insurer_id", "=", record.insurerId)
      .where("id", "=", record.requestId)
      .where("status", "=", "CONFIRMED")
      .execute();
    // O beneficiário mantém-se; só a ligação desfaz-se, e os QR já emitidos deixam de valer (`card_version`).
    await trx
      .updateTable("insurer_beneficiaries")
      .set({ family_id: null, family_member_id: null, card_version: sql<number>`card_version + 1`, updated_at: record.now })
      .where("insurer_id", "=", record.insurerId)
      .where("id", "=", record.beneficiaryId)
      .where("family_id", "=", record.familyId)
      .where("family_member_id", "=", record.memberId)
      .execute();
  }

  async listLinked(trx: Db, familyId: string, memberId: string): Promise<{ insurerId: string; beneficiaryId: string }[]> {
    const rows = await trx.selectFrom("insurer_beneficiaries").select(["insurer_id", "id"]).where("family_id", "=", familyId).where("family_member_id", "=", memberId).execute();
    return rows.map((r) => ({ insurerId: r.insurer_id, beneficiaryId: r.id }));
  }

  async findLinked(trx: Db, familyId: string, memberId: string, beneficiaryId: string): Promise<{ insurerId: string; beneficiaryId: string } | null> {
    const row = await trx.selectFrom("insurer_beneficiaries").select(["insurer_id", "id"]).where("family_id", "=", familyId).where("family_member_id", "=", memberId).where("id", "=", beneficiaryId).executeTakeFirst();
    return row ? { insurerId: row.insurer_id, beneficiaryId: row.id } : null;
  }
}
