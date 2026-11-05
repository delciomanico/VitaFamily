// Integração real (testcontainers + PostgreSQL 16) da Fase 4b (ADR-021/ADR-023): migração 0025
// (apólices, pedidos, associação pedido↔documento, `documents.insurance_policy_id`), CHECKs/FKs,
// isolamento por seguradora, documentos CLEAN do próprio membro (BR-INS-04), decisão concorrente,
// eliminação com outbox de ficheiros (ADR-011), cascata e auditoria INSURANCE_ACCOUNT.
// A autorização (`AccessPolicy`) usa o fake; é coberta nos testes unitários/matriz de `access`.
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { Pool } from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";
import { FixedClock } from "../../src/platform/clock/index.js";
import { createDb, withTransaction, type Database } from "../../src/platform/db/index.js";
import { KyselyAuditRepository } from "../../src/modules/audit/infrastructure/repo.js";
import { createDeleteAllForResourceUseCase, createListAttachableUseCase } from "../../src/modules/documents/application/for-resource.js";
import type { DocumentsDeps } from "../../src/modules/documents/application/ports.js";
import { KyselyDocumentsRepository, KyselyFileDeletionsRepository } from "../../src/modules/documents/infrastructure/repo.js";
import { FakeInsuranceAccessPolicy, FakeMembershipPort } from "../../src/modules/insurance/application/fixtures.js";
import {
  createCreateInsurancePolicyUseCase,
  createDeleteInsurancePolicyUseCase,
  createGetInsurancePolicyUseCase,
  createUpdateInsurancePolicyUseCase,
} from "../../src/modules/insurance/application/insurance-policies.js";
import { createListPartnerInsurersUseCase } from "../../src/modules/insurance/application/list-partner-insurers.js";
import type { InsuranceDocumentsPort, InsuranceHolderDeps, InsurancePortalClaimsDeps } from "../../src/modules/insurance/application/ports.js";
import { createDecideInsuranceClaimUseCase, createGetInsuranceClaimUseCase, createListInsuranceClaimsUseCase } from "../../src/modules/insurance/application/portal-claims.js";
import { createCreateReimbursementClaimUseCase, createGetReimbursementClaimUseCase, createMarkReimbursementClaimPaidUseCase } from "../../src/modules/insurance/application/reimbursement-claims.js";
import { KyselyInsurancePoliciesRepository, KyselyInsurersRepository, KyselyReimbursementClaimsRepository } from "../../src/modules/insurance/infrastructure/repo.js";

describe("integração: apólices e pedidos de reembolso (Fase 4b)", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: Kysely<Database>;
  const clock = new FixedClock(new Date("2026-11-05T10:00:00Z"));
  const ctx = { requestId: "r1" };
  const ids = {
    user: randomUUID(), family: randomUUID(), member: randomUUID(), otherMember: randomUUID(),
    insA: randomUUID(), insB: randomUUID(), accA: randomUUID(), accB: randomUUID(),
  };
  const actor = { userId: ids.user, platformAdmin: false };
  const agentA = { insuranceAccountId: ids.accA, insurerId: ids.insA, role: "INSURANCE_AGENT" as const };
  const agentB = { insuranceAccountId: ids.accB, insurerId: ids.insB, role: "INSURANCE_AGENT" as const };

  const documentsRepo = new KyselyDocumentsRepository();
  const fileDeletionsRepo = new KyselyFileDeletionsRepository();
  const documentsDeps = { documentsRepo, fileDeletionsRepo } as unknown as DocumentsDeps<Kysely<Database>>;
  const documents: InsuranceDocumentsPort<Kysely<Database>> = {
    listForResource: (trx, familyId, memberId, resourceType, resourceId) => documentsRepo.listByResource(trx, familyId, memberId, resourceType, resourceId),
    deleteAllForResource: createDeleteAllForResourceUseCase(documentsDeps),
    listAttachable: createListAttachableUseCase(documentsDeps),
  };
  const claimsRepo = new KyselyReimbursementClaimsRepository();
  const policy = new FakeInsuranceAccessPolicy();
  const membership = new FakeMembershipPort();
  const audit = new KyselyAuditRepository();

  function holderDeps(): InsuranceHolderDeps<Kysely<Database>> {
    return {
      policiesRepo: new KyselyInsurancePoliciesRepository(),
      claimsRepo,
      insurersRepo: new KyselyInsurersRepository(),
      policy,
      membership,
      documents,
      audit,
      db,
      withTransaction: (fn) => withTransaction(db, fn),
      clock,
    };
  }
  function portalDeps(): InsurancePortalClaimsDeps<Kysely<Database>> {
    return { claimsRepo, audit, withTransaction: (fn) => withTransaction(db, fn), clock };
  }

  /** Documento do membro (receita/exame/apólice) com o estado de antivírus pedido. */
  async function newDoc(opts: { member?: string; scan?: "PENDING" | "CLEAN" | "INFECTED"; policyId?: string } = {}): Promise<string> {
    const id = randomUUID();
    const member = opts.member ?? ids.member;
    let examId: string | null = null;
    if (!opts.policyId) {
      examId = randomUUID();
      await pool.query("INSERT INTO examinations (id, family_id, member_id, name, exam_date, status) VALUES ($1,$2,$3,'Hemograma','2026-10-01','COMPLETED')", [examId, ids.family, member]);
    }
    await pool.query(
      "INSERT INTO documents (id, family_id, member_id, examination_id, insurance_policy_id, storage_key, original_name, mime_type, size_bytes, checksum_sha256, scan_status) VALUES ($1,$2,$3,$4,$5,$6,'f.pdf','application/pdf',10,'abc',$7)",
      [id, ids.family, member, examId, opts.policyId ?? null, `documents/${id}.pdf`, opts.scan ?? "CLEAN"],
    );
    return id;
  }

  async function partnerPolicy(insurerId = ids.insA): Promise<string> {
    return (await createCreateInsurancePolicyUseCase(holderDeps())(actor, ids.family, ids.member, { insurerName: "Seg", policyNumber: "P-9", holderName: "Ana", insurerId, validUntil: "2027-01-31" }, ctx)).id;
  }

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({ POSTGRES_USER: "vita", POSTGRES_PASSWORD: "vita", POSTGRES_DB: "vita" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    pool = new Pool({ connectionString: `postgres://vita:vita@${container.getHost()}:${String(container.getMappedPort(5432))}/vita` });
    db = createDb(pool);
    await runMigrations(pool, defaultMigrationsDir());
    await pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, terms_accepted_version, terms_accepted_at) VALUES ($1,'a@b.pt','x','Ana','1990-01-01','Europe/Lisbon','1',now())", [ids.user]);
    await pool.query("INSERT INTO families (id, name) VALUES ($1,'Fam')", [ids.family]);
    await pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role) VALUES ($1,$2,$3,'Ana','1990-01-01','FAMILY_ADMIN')", [ids.member, ids.family, ids.user]);
    await pool.query("INSERT INTO family_members (id, family_id, name, birth_date, is_dependent) VALUES ($1,$2,'Dep','2015-01-01',true)", [ids.otherMember, ids.family]);
    await pool.query("INSERT INTO insurer_accounts (id, name, tax_id) VALUES ($1,'Seguradora A','500000001'), ($2,'Seguradora B','500000002')", [ids.insA, ids.insB]);
    await pool.query("INSERT INTO insurance_accounts (id, insurer_id, email, password_hash, role) VALUES ($1,$2,'a@a.pt','x','INSURANCE_AGENT'), ($3,$4,'b@b.pt','x','INSURANCE_AGENT')", [ids.accA, ids.insA, ids.accB, ids.insB]);
    membership.members.add(`${ids.family}:${ids.user}`);
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it("apólice: round-trip (data sem deslocação de fuso, cardDocumentId derivado), seguradora parceira só ACTIVE, PATCH", async () => {
    const id = await partnerPolicy();
    const get = createGetInsurancePolicyUseCase(holderDeps());
    const view = await get(actor, ids.family, ids.member, id, ctx);
    expect(view).toMatchObject({ id, insurerId: ids.insA, validUntil: "2027-01-31", cardDocumentId: null, familyId: ids.family, memberId: ids.member });

    const card = await newDoc({ policyId: id });
    expect((await get(actor, ids.family, ids.member, id, ctx)).cardDocumentId).toBe(card);

    const update = createUpdateInsurancePolicyUseCase(holderDeps());
    expect(await update(actor, ids.family, ids.member, id, { insurerId: null, validUntil: null, holderName: "Ana S." }, ctx)).toMatchObject({ holderName: "Ana S.", cardDocumentId: card });
    expect((await get(actor, ids.family, ids.member, id, ctx)).insurerId).toBeUndefined();
    await pool.query("UPDATE insurer_accounts SET status='SUSPENDED' WHERE id=$1", [ids.insB]);
    await expect(update(actor, ids.family, ids.member, id, { insurerId: ids.insB }, ctx)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(get(actor, ids.family, ids.otherMember, id, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await createListPartnerInsurersUseCase(holderDeps())(actor, ids.family)).toEqual([{ id: ids.insA, name: "Seguradora A" }]);
    await pool.query("UPDATE insurer_accounts SET status='ACTIVE' WHERE id=$1", [ids.insB]);
  });

  it("documents: INSURANCE_POLICY mapeia coluna; FK composta recusa apólice de outro membro; CHECK de um só recurso", async () => {
    const id = await partnerPolicy();
    const base = { id: randomUUID(), familyId: ids.family, memberId: ids.member, resourceType: "INSURANCE_POLICY" as const, resourceId: id, storageKey: `quarantine/${randomUUID()}`, originalName: "c.pdf", mimeType: "application/pdf", sizeBytes: 5, checksumSha256: "x", createdAt: new Date() };
    const inserted = await withTransaction(db, (trx) => documentsRepo.insert(trx, base));
    expect(inserted).toMatchObject({ resourceType: "INSURANCE_POLICY", resourceId: id });
    // Mesma apólice, outro membro da família ⇒ a FK composta (family_id, member_id, insurance_policy_id) recusa.
    await expect(withTransaction(db, (trx) => documentsRepo.insert(trx, { ...base, id: randomUUID(), storageKey: `quarantine/${randomUUID()}`, memberId: ids.otherMember }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(withTransaction(db, (trx) => documentsRepo.insert(trx, { ...base, id: randomUUID(), storageKey: `quarantine/${randomUUID()}`, resourceId: randomUUID() }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      pool.query("INSERT INTO documents (family_id, member_id, examination_id, insurance_policy_id, storage_key, original_name, mime_type, size_bytes, checksum_sha256) VALUES ($1,$2,$3,$4,'k1','a','b',1,'c')", [ids.family, ids.member, randomUUID(), id]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("CHECKs de reimbursement_claims: amount > 0; REJECTED exige nota; SUBMITTED sem nota é válido", async () => {
    const policyId = await partnerPolicy();
    const insert = (amount: number, status: string, note: string | null) =>
      pool.query("INSERT INTO reimbursement_claims (policy_id, insurer_id, amount, status, decision_note) VALUES ($1,$2,$3,$4,$5)", [policyId, ids.insA, amount, status, note]);
    await expect(insert(0, "SUBMITTED", null)).rejects.toMatchObject({ code: "23514" });
    await expect(insert(5, "REJECTED", null)).rejects.toMatchObject({ code: "23514" });
    await insert(5, "SUBMITTED", null);
    await insert(5, "REJECTED", "motivo");
  });

  it("fluxo completo: submissão (documentos CLEAN do membro), portal isolado e minimizado, decisão, PAID, auditoria", async () => {
    const policyId = await partnerPolicy();
    const clean = await newDoc();
    const pending = await newDoc({ scan: "PENDING" });
    const infected = await newDoc({ scan: "INFECTED" });
    const foreign = await newDoc({ member: ids.otherMember });
    const create = createCreateReimbursementClaimUseCase(holderDeps());

    for (const bad of [pending, infected, foreign, randomUUID()]) {
      await expect(create(actor, ids.family, ids.member, policyId, { amount: 10, documentIds: [bad] }, ctx)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
    expect((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM reimbursement_claims WHERE policy_id=$1", [policyId])).rows[0]?.n).toBe(0);

    const claim = await create(actor, ids.family, ids.member, policyId, { amount: 42.5, documentIds: [clean] }, ctx);
    expect(claim).toMatchObject({ status: "SUBMITTED", amount: 42.5, currency: "EUR", insurerId: ids.insA, documentIds: [clean] });

    const listA = await createListInsuranceClaimsUseCase(portalDeps())(agentA, {});
    expect(listA.find((c) => c.id === claim.id)).toEqual({ id: claim.id, status: "SUBMITTED", amount: 42.5, currency: "EUR", policyHolderName: "Ana", policyNumber: "P-9", decisionNote: null, documentIds: [clean] });
    expect((await createListInsuranceClaimsUseCase(portalDeps())(agentB, {})).map((c) => c.id)).not.toContain(claim.id);
    await expect(createGetInsuranceClaimUseCase(portalDeps())(agentB, claim.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createDecideInsuranceClaimUseCase(portalDeps())(agentB, claim.id, { decision: "APPROVE" }, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const pay = createMarkReimbursementClaimPaidUseCase(holderDeps());
    await expect(pay(actor, ids.family, ids.member, policyId, claim.id, ctx)).rejects.toMatchObject({ code: "CONFLICT" });
    const decided = await createDecideInsuranceClaimUseCase(portalDeps())(agentA, claim.id, { decision: "APPROVE", note: "ok" }, ctx);
    expect(decided).toMatchObject({ status: "APPROVED", decisionNote: "ok" });
    const row = (await pool.query<{ decided_by_insurance_account_id: string; decided_at: Date }>("SELECT decided_by_insurance_account_id, decided_at FROM reimbursement_claims WHERE id=$1", [claim.id])).rows[0];
    expect(row?.decided_by_insurance_account_id).toBe(ids.accA);
    expect(row?.decided_at).toBeInstanceOf(Date);
    expect(await pay(actor, ids.family, ids.member, policyId, claim.id, ctx)).toMatchObject({ status: "PAID" });
    expect(await createGetReimbursementClaimUseCase(holderDeps())(actor, ids.family, ids.member, policyId, claim.id, ctx)).toMatchObject({ status: "PAID", decisionNote: "ok" });

    const logs = await pool.query("SELECT action, actor_type::text, actor_user_id, actor_insurance_account_id, family_id, subject_member_id, metadata FROM audit_logs WHERE resource_id=$1 ORDER BY id", [claim.id]);
    expect(logs.rows.map((r: { action: string }) => r.action)).toEqual(["CLAIM_SUBMIT", "CLAIM_DECIDE", "CLAIM_PAID"]);
    expect(logs.rows[1]).toMatchObject({ actor_type: "INSURANCE_ACCOUNT", actor_user_id: null, actor_insurance_account_id: ids.accA, family_id: ids.family, subject_member_id: ids.member });
    expect(JSON.stringify(logs.rows)).not.toContain("P-9");
  });

  it("decisões concorrentes: exatamente uma vence, a outra recebe CONFLICT (linha bloqueada)", async () => {
    const policyId = await partnerPolicy();
    const doc = await newDoc();
    const claim = await createCreateReimbursementClaimUseCase(holderDeps())(actor, ids.family, ids.member, policyId, { amount: 1, documentIds: [doc] }, ctx);
    const decide = createDecideInsuranceClaimUseCase(portalDeps());

    const results = await Promise.allSettled([
      decide(agentA, claim.id, { decision: "APPROVE" }, ctx),
      decide(agentA, claim.id, { decision: "REJECT", note: "não" }, ctx),
      decide(agentA, claim.id, { decision: "APPROVE", note: "outra" }, ctx),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(failures.map((f) => (f.reason as { code: string }).code)).toEqual(["CONFLICT", "CONFLICT"]);
  });

  it("DELETE da apólice: CONFLICT com pedido ativo; senão foto vai para file_deletions, pedidos saem em cascata; outros documentos ficam", async () => {
    const policyId = await partnerPolicy();
    const card = await newDoc({ policyId });
    const invoice = await newDoc();
    const claim = await createCreateReimbursementClaimUseCase(holderDeps())(actor, ids.family, ids.member, policyId, { amount: 9, documentIds: [invoice, card] }, ctx);
    const remove = createDeleteInsurancePolicyUseCase(holderDeps());

    await expect(remove(actor, ids.family, ids.member, policyId, ctx)).rejects.toMatchObject({ code: "CONFLICT" });
    await createDecideInsuranceClaimUseCase(portalDeps())(agentA, claim.id, { decision: "REJECT", note: "sem cobertura" }, ctx);
    await remove(actor, ids.family, ids.member, policyId, ctx);

    expect((await pool.query("SELECT 1 FROM insurance_policies WHERE id=$1", [policyId])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM reimbursement_claims WHERE id=$1", [claim.id])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM reimbursement_claim_documents WHERE claim_id=$1", [claim.id])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM documents WHERE id=$1", [card])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM documents WHERE id=$1", [invoice])).rowCount).toBe(1);
    expect((await pool.query("SELECT 1 FROM file_deletions WHERE storage_key=$1", [`documents/${card}.pdf`])).rowCount).toBe(1);
    expect((await pool.query("SELECT 1 FROM file_deletions WHERE storage_key=$1", [`documents/${invoice}.pdf`])).rowCount).toBe(0);
  });

  it("apagar um documento anexado remove só a associação (cascata); remover o membro apaga apólices e pedidos", async () => {
    const policyId = await partnerPolicy();
    const doc1 = await newDoc();
    const doc2 = await newDoc();
    const claim = await createCreateReimbursementClaimUseCase(holderDeps())(actor, ids.family, ids.member, policyId, { amount: 3, documentIds: [doc1, doc2] }, ctx);
    await pool.query("DELETE FROM documents WHERE id=$1", [doc1]);
    expect((await createGetReimbursementClaimUseCase(holderDeps())(actor, ids.family, ids.member, policyId, claim.id, ctx)).documentIds).toEqual([doc2]);

    const tmpMember = randomUUID();
    await pool.query("INSERT INTO family_members (id, family_id, name, birth_date, is_dependent) VALUES ($1,$2,'Tmp','2015-01-01',true)", [tmpMember, ids.family]);
    const tmpPolicy = await createCreateInsurancePolicyUseCase(holderDeps())(actor, ids.family, tmpMember, { insurerName: "S", policyNumber: "T", holderName: "Tmp", insurerId: ids.insA }, ctx);
    const tmpDoc = await newDoc({ member: tmpMember });
    await createCreateReimbursementClaimUseCase(holderDeps())(actor, ids.family, tmpMember, tmpPolicy.id, { amount: 1, documentIds: [tmpDoc] }, ctx);
    await pool.query("DELETE FROM family_members WHERE id=$1", [tmpMember]);
    expect((await pool.query("SELECT 1 FROM insurance_policies WHERE id=$1", [tmpPolicy.id])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM reimbursement_claims WHERE policy_id=$1", [tmpPolicy.id])).rowCount).toBe(0);
  });
});
