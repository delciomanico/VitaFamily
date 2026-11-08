// Integração real (testcontainers + PostgreSQL 16) da etapa R (migração 0030, BR-CLN-31..40, TC-CLN-17..20): numeração sem
// buracos nem duplicados (20 emissões concorrentes e rollback a meio), UNIQUE parcial um ISSUED por marcação, CHECK VOIDED,
// cascatas (membro/família/clínica), CHECK e UNIQUE de professional_id, backfill de actor_clinic_id, enum novo utilizável,
// auditoria da clínica (só a própria clínica, sem PII) e anexos a pedidos de reembolso.
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { Pool } from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";
import { runWithClinicActor } from "../../src/platform/actor/index.js";
import { createDb, withTransaction, type Database } from "../../src/platform/db/index.js";
import { KyselyAuditRepository, KyselyClinicAuditReader } from "../../src/modules/audit/infrastructure/repo.js";
import { KyselyReceiptsRepository } from "../../src/modules/clinic-receipts/infrastructure/repo.js";
import { KyselyReimbursementClaimsRepository } from "../../src/modules/insurance/infrastructure/repo.js";

describe("integração: recibos, perfil, papel Médico e auditoria da clínica (migração 0030)", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: Kysely<Database>;
  let workDir: string;
  const repo = new KyselyReceiptsRepository();
  const audit = new KyselyAuditRepository();
  const clinicA = randomUUID();
  const clinicB = randomUUID();
  const oldAccount = randomUUID();
  const oldAuditLogId = randomUUID();
  const NOW = new Date("2026-11-08T12:00:00.000Z");

  async function newMember() {
    const familyId = randomUUID(), userId = randomUUID(), memberId = randomUUID();
    await pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, terms_accepted_version, terms_accepted_at) VALUES ($1,$2,'x','Maria','1990-01-01','Europe/Lisbon','ACTIVE','1',now())", [userId, `${userId}@example.pt`]);
    await pool.query("INSERT INTO families (id, name) VALUES ($1,'Fam')", [familyId]);
    await pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role) VALUES ($1,$2,$3,'Maria','1990-01-01','FAMILY_ADMIN')", [memberId, familyId, userId]);
    return { familyId, userId, memberId };
  }
  const record = (clinicId: string, bookingId = randomUUID(), kind: "APPOINTMENT" | "EXAM" | "VISIT" = "APPOINTMENT") => ({
    id: randomUUID(),
    clinicId,
    bookingKind: kind,
    bookingId,
    paymentMethod: "CASH" as const,
    currency: "AOA",
    totalMinor: 1500,
    patientName: "Maria Silva",
    note: null,
    issuer: { name: "Clínica Sol", address: null, phone: null, email: null },
    lines: [{ position: 1, description: "Consulta", amountMinor: 1500, serviceTypeId: null }],
    issuedAt: NOW,
    issuedByClinicAccountId: null,
  });
  async function issue(clinicId: string, bookingId?: string, kind?: "APPOINTMENT" | "EXAM" | "VISIT") {
    return withTransaction(db, async (trx) => {
      const number = await repo.nextNumber(trx, clinicId);
      return repo.insert(trx, record(clinicId, bookingId, kind), number);
    });
  }
  async function newAccount(clinicId: string, role: string, professionalId: string | null = null) {
    const id = randomUUID();
    await pool.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role, professional_id) VALUES ($1,$2,$3,'x',$4::clinic_account_role,$5)", [id, clinicId, `${id}@c.pt`, role, professionalId]);
    return id;
  }

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({ POSTGRES_USER: "vita", POSTGRES_PASSWORD: "vita", POSTGRES_DB: "vita" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    pool = new Pool({ connectionString: `postgres://vita:vita@${container.getHost()}:${String(container.getMappedPort(5432))}/vita` });
    db = createDb(pool);
    // 1.º passo: tudo até à 0029, com uma conta de clínica e uma entrada de auditoria "antigas".
    workDir = await mkdtemp(join(tmpdir(), "vita-mig-"));
    await mkdir(workDir, { recursive: true });
    for (const file of (await readdir(defaultMigrationsDir())).filter((f) => f.endsWith(".sql") && f < "0030")) {
      await copyFile(join(defaultMigrationsDir(), file), join(workDir, file));
    }
    await runMigrations(pool, workDir);
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Clínica Sol'), ($2,'PARTNER','Outra')", [clinicA, clinicB]);
    await pool.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role) VALUES ($1,$2,'velha@c.pt','x','CLINIC_MANAGER')", [oldAccount, clinicA]);
    await pool.query("INSERT INTO audit_logs (actor_type, actor_clinic_account_id, action, resource_type, result, request_id) VALUES ('CLINIC_ACCOUNT',$1,'CLINIC_SLOT_PUBLISH','ClinicSlot','SUCCESS','old')", [oldAccount]);
    await pool.query("INSERT INTO audit_logs (actor_type, actor_clinic_account_id, action, resource_type, result, request_id) VALUES ('CLINIC_ACCOUNT',$1,'CLINIC_SLOT_PUBLISH','ClinicSlot','SUCCESS','orphan')", [oldAuditLogId]);
    // 2.º passo: a migração da etapa R sobre dados existentes.
    await runMigrations(pool, defaultMigrationsDir());
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  it("0030 aplicada numa só transação (com ADD VALUE); contas existentes intactas e o enum novo aceita-se depois", async () => {
    expect((await pool.query("SELECT version FROM schema_migrations")).rows.map((r: { version: string }) => r.version)).toContain("0030_clinic_receipts_profile_roles");
    expect((await pool.query("SELECT role::text, professional_id FROM clinic_accounts WHERE id=$1", [oldAccount])).rows[0]).toEqual({ role: "CLINIC_MANAGER", professional_id: null });
    await newAccount(clinicA, "CLINIC_MANAGER");
    expect((await pool.query("SELECT 'CLINIC_DOCTOR'::clinic_account_role::text AS v")).rows[0]).toEqual({ v: "CLINIC_DOCTOR" });
  });

  it("backfill: actor_clinic_id preenchido nas entradas de contas existentes; conta já removida fica sem clínica", async () => {
    const rows = (await pool.query("SELECT request_id, actor_clinic_id FROM audit_logs WHERE request_id IN ('old','orphan') ORDER BY request_id")).rows;
    expect(rows).toEqual([
      { request_id: "old", actor_clinic_id: clinicA },
      { request_id: "orphan", actor_clinic_id: null },
    ]);
  });

  it("papel Médico: CHECK (CLINIC_DOCTOR <=> professional_id) e UNIQUE de professional_id (uma conta por profissional)", async () => {
    const prof = randomUUID();
    const profB = randomUUID();
    await pool.query("INSERT INTO clinic_professionals (id, clinic_id, name) VALUES ($1,$2,'Dra. Lima'), ($3,$4,'Dr. Outro')", [prof, clinicA, profB, clinicB]);
    await expect(newAccount(clinicA, "CLINIC_DOCTOR", null)).rejects.toThrow(/doctor_professional_check/);
    await expect(newAccount(clinicA, "CLINIC_MANAGER", prof)).rejects.toThrow(/doctor_professional_check/);
    await expect(newAccount(clinicA, "CLINIC_DOCTOR", profB)).rejects.toThrow(/professional_fk/); // profissional de outra clínica
    await newAccount(clinicA, "CLINIC_DOCTOR", prof);
    await expect(newAccount(clinicA, "CLINIC_DOCTOR", prof)).rejects.toThrow(/professional_uq/);
  });

  it("perfil: CHECKs de displayName/description/openingHours", async () => {
    await pool.query("UPDATE clinics SET display_name='Sol Saúde', description='x', opening_hours='Seg-Sex' WHERE id=$1", [clinicA]);
    await expect(pool.query("UPDATE clinics SET display_name='' WHERE id=$1", [clinicA])).rejects.toThrow(/display_name_check/);
    await expect(pool.query("UPDATE clinics SET description=$2 WHERE id=$1", [clinicA, "x".repeat(501)])).rejects.toThrow(/description_check/);
    await expect(pool.query("UPDATE clinics SET opening_hours=$2 WHERE id=$1", [clinicA, "x".repeat(501)])).rejects.toThrow(/opening_hours_check/);
  });

  it("numeração: 20 emissões concorrentes sem buracos nem duplicados; outra clínica independente", async () => {
    const clinic = randomUUID();
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Concorrente')", [clinic]);
    const results = await Promise.all(Array.from({ length: 20 }, () => issue(clinic)));
    expect(results.map((r) => r.number).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect((await issue(clinicB)).number).toBe(1);
  });

  it("numeração: a transação que falha a meio devolve o número (sem buraco)", async () => {
    const clinic = randomUUID();
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Rollback')", [clinic]);
    expect((await issue(clinic)).number).toBe(1);
    await expect(
      withTransaction(db, async (trx) => {
        await repo.nextNumber(trx, clinic);
        throw new Error("falha a meio");
      }),
    ).rejects.toThrow("falha a meio");
    expect((await issue(clinic)).number).toBe(2);
    // Violação de UNIQUE parcial dentro da transação também reverte o contador.
    const booking = randomUUID();
    await issue(clinic, booking);
    await expect(issue(clinic, booking)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await issue(clinic)).number).toBe(4);
  });

  it("UNIQUE parcial: um ISSUED por marcação; depois de anulado emite-se outro; CHECK VOIDED; só o estado muda (imutável)", async () => {
    const booking = randomUUID();
    const first = await issue(clinicA, booking);
    await expect(issue(clinicA, booking)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(pool.query("UPDATE clinic_receipts SET status='VOIDED' WHERE id=$1", [first.id])).rejects.toThrow(/voided_check/);
    await expect(pool.query("UPDATE clinic_receipts SET status='VOIDED', voided_at=now(), void_reason='ab' WHERE id=$1", [first.id])).rejects.toThrow(/void_reason_check/);
    // Anular só muda estado/carimbos (BR-CLN-33): o repositório real faz exatamente este UPDATE.
    const accountId = await newAccount(clinicA, "CLINIC_MANAGER");
    const voided = await withTransaction(db, (trx) => repo.markVoided(trx, clinicA, first.id, "Valor errado", accountId, NOW));
    expect(voided).toMatchObject({ status: "VOIDED", voidReason: "Valor errado", totalMinor: 1500 });
    const second = await issue(clinicA, booking);
    expect(second.number).toBeGreaterThan(first.number);
    const stored: unknown = (await pool.query("SELECT status, total_minor::int AS total, (SELECT count(*)::int FROM clinic_receipt_lines WHERE receipt_id=$1) AS lines FROM clinic_receipts WHERE id=$1", [first.id])).rows[0];
    expect(stored).toEqual({ status: "VOIDED", total: 1500, lines: 1 });
  });

  it("isolamento: o repositório só encontra recibos da própria clínica; Financeiro soma só ISSUED do período", async () => {
    const r = await issue(clinicB);
    expect(await withTransaction(db, (trx) => repo.findById(trx, clinicA, r.id))).toBeNull();
    expect((await withTransaction(db, (trx) => repo.findById(trx, clinicB, r.id)))?.id).toBe(r.id);
    const clinic = randomUUID();
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Financeiro')", [clinic]);
    const a = await issue(clinic);
    await issue(clinic);
    await pool.query("UPDATE clinic_receipts SET status='VOIDED', voided_at=now(), void_reason='Motivo' WHERE id=$1", [a.id]);
    const summary = await withTransaction(db, (trx) => repo.summarize(trx, clinic, new Date("2026-11-08T00:00:00Z"), new Date("2026-11-09T00:00:00Z")));
    expect(summary).toEqual({ issuedCount: 1, issuedTotalMinor: 1500, voidedCount: 1 });
  });

  it("ligação ao paciente: apagar o membro apaga só a ligação (o recibo mantém-se, sem ids Vita); apagar a clínica apaga recibos, linhas, ligações e anexos", async () => {
    const m = await newMember();
    const clinic = randomUUID();
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Cascata')", [clinic]);
    const receipt = await issue(clinic);
    await withTransaction(db, (trx) => repo.insertLink(trx, receipt.id, m.familyId, m.memberId, NOW));
    expect((await withTransaction(db, (trx) => repo.listLinkedByMember(trx, m.familyId, m.memberId, undefined, 10))).map((r) => r.id)).toEqual([receipt.id]);
    await pool.query("DELETE FROM family_members WHERE id=$1", [m.memberId]);
    expect((await pool.query("SELECT count(*)::int AS n FROM clinic_receipt_links WHERE receipt_id=$1", [receipt.id])).rows[0]).toEqual({ n: 0 });
    expect((await pool.query("SELECT count(*)::int AS n FROM clinic_receipts WHERE id=$1", [receipt.id])).rows[0]).toEqual({ n: 1 });
    expect(JSON.stringify((await pool.query("SELECT * FROM clinic_receipts WHERE id=$1", [receipt.id])).rows)).not.toContain(m.familyId);
    await pool.query("DELETE FROM clinics WHERE id=$1", [clinic]);
    for (const table of ["clinic_receipts", "clinic_receipt_lines", "clinic_receipt_counters"]) {
      expect((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE clinic_id=$1`, [clinic])).rows[0]).toEqual({ n: 0 });
    }
  });

  it("anexos a pedidos de reembolso: associação simples; só pedidos ativos contam; REJECTED liberta; apagar o recibo apaga a associação", async () => {
    const m = await newMember();
    const insurer = randomUUID();
    const policy = randomUUID();
    const claim1 = randomUUID();
    const claim2 = randomUUID();
    await pool.query("INSERT INTO insurer_accounts (id, name, tax_id) VALUES ($1,'Seg','500')", [insurer]);
    await pool.query("INSERT INTO insurance_policies (id, family_id, member_id, insurer_name, policy_number, holder_name) VALUES ($1,$2,$3,'Seg','P','Ana')", [policy, m.familyId, m.memberId]);
    for (const id of [claim1, claim2]) await pool.query("INSERT INTO reimbursement_claims (id, policy_id, insurer_id, amount, currency) VALUES ($1,$2,$3,10,'AOA')", [id, policy, insurer]);
    const receipt = await issue(clinicA);
    await pool.query("INSERT INTO reimbursement_claim_receipts (claim_id, receipt_id) VALUES ($1,$2)", [claim1, receipt.id]);
    const claims = new KyselyReimbursementClaimsRepository();
    expect((await withTransaction(db, (trx) => claims.activeClaimIdsByReceipts(trx, [receipt.id]))).get(receipt.id)).toEqual([claim1]);
    expect((await withTransaction(db, (trx) => claims.findForPolicy(trx, policy, claim1)))?.receiptIds).toEqual([receipt.id]);
    await pool.query("UPDATE reimbursement_claims SET status='REJECTED', decision_note='n' WHERE id=$1", [claim1]);
    expect((await withTransaction(db, (trx) => claims.activeClaimIdsByReceipts(trx, [receipt.id]))).size).toBe(0);
    await expect(pool.query("INSERT INTO reimbursement_claim_receipts (claim_id, receipt_id) VALUES ($1,$2), ($1,$2)", [claim2, receipt.id])).rejects.toThrow();
    await pool.query("DELETE FROM clinic_receipts WHERE id=$1", [receipt.id]);
    expect((await pool.query("SELECT count(*)::int AS n FROM reimbursement_claim_receipts")).rows[0]).toEqual({ n: 0 });
  });

  it("auditoria da clínica: actor_clinic_id vem do token; leitura só da própria clínica e só contas do portal, sem PII", async () => {
    const accountA = await newAccount(clinicA, "CLINIC_MANAGER");
    const accountB = await newAccount(clinicB, "CLINIC_MANAGER");
    const common = { occurredAt: NOW, resourceType: "ClinicReceipt", result: "SUCCESS" as const, requestId: "req-x", ip: "10.1.2.3", userAgent: "UA-SECRETO", metadata: { lineCount: 1 } };
    await withTransaction(db, async (trx) => {
      // 1) dentro do contexto do ator (token): clínica resolvida do ator.
      await runWithClinicActor({ clinicAccountId: accountA, clinicId: clinicA, role: "CLINIC_MANAGER", sessionId: "s" }, () => audit.record(trx, { ...common, actorType: "CLINIC_ACCOUNT", actorClinicAccountId: accountA, action: "CLINIC_RECEIPT_ISSUE" }));
      // 2) explícito (login, sem sessão).
      await audit.record(trx, { ...common, actorType: "CLINIC_ACCOUNT", actorClinicAccountId: accountA, actorClinicId: clinicA, action: "CLINIC_ACCOUNT_LOGIN" });
      // 3) outra clínica, um utilizador Vita e o sistema: nunca aparecem na vista da clínica A.
      await audit.record(trx, { ...common, actorType: "CLINIC_ACCOUNT", actorClinicAccountId: accountB, actorClinicId: clinicB, action: "CLINIC_RECEIPT_ISSUE" });
      await audit.record(trx, { ...common, actorType: "USER", actorUserId: randomUUID(), action: "CLAIM_SUBMIT" });
      await audit.record(trx, { ...common, actorType: "SYSTEM", action: "CLINIC_SCHEDULE_GENERATE" });
      // 4) conta cujo ator tem outra clínica no contexto: o contexto só vale se coincidir com a conta do evento.
      await runWithClinicActor({ clinicAccountId: accountB, clinicId: clinicB, role: "CLINIC_MANAGER", sessionId: "s" }, () => audit.record(trx, { ...common, actorType: "CLINIC_ACCOUNT", actorClinicAccountId: accountA, action: "CLINIC_STAFF_REMOVE" }));
    });
    const reader = new KyselyClinicAuditReader();
    const page1 = await withTransaction(db, (trx) => reader.list(trx, { clinicId: clinicA, from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-12-31T00:00:00Z") }, 2));
    expect(page1).toHaveLength(2);
    const all = await withTransaction(db, (trx) => reader.list(trx, { clinicId: clinicA, from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-12-31T00:00:00Z") }, 50));
    expect(all.map((e) => e.action).sort()).toEqual(["CLINIC_ACCOUNT_LOGIN", "CLINIC_RECEIPT_ISSUE", "CLINIC_SLOT_PUBLISH"]);
    expect(all.every((e) => e.actorAccountId === accountA || e.actorAccountId === oldAccount)).toBe(true);
    // keyset: continuar depois da 1.ª entrada não repete.
    const after = await withTransaction(db, (trx) => reader.list(trx, { clinicId: clinicA, from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-12-31T00:00:00Z"), after: { occurredAt: page1[0]?.occurredAt ?? NOW, id: page1[0]?.id ?? "0" } }, 50));
    expect(after.map((e) => e.id)).not.toContain(page1[0]?.id);
    expect(Object.keys(all[0] ?? {}).sort()).toEqual(["action", "actorAccountId", "id", "occurredAt", "resourceId", "resourceType", "result"]);
    expect(JSON.stringify(all)).not.toMatch(/10\.1\.2\.3|UA-SECRETO|req-x|lineCount/);
    expect(await withTransaction(db, (trx) => reader.list(trx, { clinicId: randomUUID(), from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-12-31T00:00:00Z") }, 50))).toEqual([]);
  });
});
