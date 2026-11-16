// Casos de uso de `processes` sobre fakes (UC-PRC-01..05; AC-PRC-01/03/06; TC-PRC-11, 13, 15, 16, 21, 22, 23; TC-AZ-PRC-01).
import { beforeEach, describe, expect, it } from "vitest";
import { DomainError, ForbiddenError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { FixedClock } from "../../../platform/clock/index.js";
import type { Relation } from "../../access/index.js";
import { createGetClinicProcessUseCase } from "./get-clinic-process.js";
import { createGetProcessUseCase } from "./get-process.js";
import { createDiscardProcessUseCase, createOpenProcessUseCase } from "./link-process.js";
import { createListProcessesUseCase, MAX_SCAN } from "./list-processes.js";
import { createProcessesFixtures, type FakeTrx, type ProcessesFixtures } from "./fixtures.js";
import type { ActorIdentity, ClinicPortalActor, ProcessActor, RequestContext } from "./ports.js";

const NOW = new Date("2026-06-01T12:00:00Z");
const FAMILY = "family-1";
const MEMBER = "member-1";
const USER: ActorIdentity = { userId: "user-1", platformAdmin: false };
const CONTEXT: RequestContext = { requestId: "req-1" };
const TRX = {} as FakeTrx;
const BY_USER: ProcessActor = { actorType: "USER", actorUserId: "user-1", requestId: "req-1" };
const BY_CLINIC: ProcessActor = { actorType: "CLINIC_ACCOUNT", actorClinicAccountId: "acc-1", requestId: "req-2" };

let fx: ProcessesFixtures;
beforeEach(() => {
  fx = createProcessesFixtures(new FixedClock(NOW));
});

/** `n` processos de consulta com `openedAt` decrescente no tempo a partir de `index` 0 (o mais recente). */
function seedMany(n: number, phaseOf: (index: number) => "SCHEDULED" | "DONE" = () => "SCHEDULED"): string[] {
  const ids: string[] = [];
  for (let index = 0; index < n; index++) {
    const id = `p-${String(index).padStart(3, "0")}`;
    fx.addProcess({ id, openedAt: new Date(NOW.getTime() - index * 60_000), phase: phaseOf(index) });
    ids.push(id);
  }
  return ids;
}

describe("ProcessLinker.open/discard (UC-PRC-01/02, BR-PRC-01/07/11)", () => {
  const open = () => createOpenProcessUseCase(fx.deps);

  it("TC-PRC-11 open é idempotente por (originType, originId): mesmo processId, 1 linha, 1 auditoria", async () => {
    const input = { familyId: FAMILY, memberId: MEMBER, originType: "APPOINTMENT", originId: "appt-1", clinicId: "clinic-1", by: BY_USER } as const;
    const first = await open()(TRX, input);
    const second = await open()(TRX, input);
    expect(second).toEqual(first);
    expect(fx.repo.rows).toHaveLength(1);
    expect(fx.repo.rows[0]).toMatchObject({ kind: "ROUTINE", originType: "APPOINTMENT", originId: "appt-1", clinicId: "clinic-1", openedAt: NOW });
    expect(fx.audit.events).toHaveLength(1);
  });

  it("TC-PRC-21 PROCESS_OPEN: ator do fluxo, família+membro, metadata só originType/kind", async () => {
    await open()(TRX, { familyId: FAMILY, memberId: MEMBER, originType: "EXAMINATION", originId: "exam-1", by: BY_CLINIC });
    expect(fx.audit.events).toEqual([
      expect.objectContaining({ action: "PROCESS_OPEN", resourceType: "Process", actorType: "CLINIC_ACCOUNT", actorClinicAccountId: "acc-1", familyId: FAMILY, subjectMemberId: MEMBER, requestId: "req-2", metadata: { originType: "EXAMINATION", kind: "ROUTINE" } }),
    ]);
    expect(fx.audit.events[0]?.actorUserId).toBeUndefined();
  });

  it("TC-PRC-13 discard apaga o processo do ato e audita PROCESS_DISCARD; sem processo não faz nada", async () => {
    await open()(TRX, { familyId: FAMILY, memberId: MEMBER, originType: "APPOINTMENT", originId: "appt-1", by: BY_USER });
    const discard = createDiscardProcessUseCase(fx.deps);
    await discard(TRX, { originType: "APPOINTMENT", originId: "appt-1", by: BY_USER });
    await discard(TRX, { originType: "APPOINTMENT", originId: "appt-1", by: BY_USER });
    expect(fx.repo.rows).toHaveLength(0);
    expect(fx.audit.events.map((e) => e.action)).toEqual(["PROCESS_OPEN", "PROCESS_DISCARD"]);
    expect(fx.audit.events[1]).toMatchObject({ familyId: FAMILY, subjectMemberId: MEMBER, metadata: { originType: "APPOINTMENT" } });
  });
});

describe("listProcesses (UC-PRC-03, AC-PRC-03)", () => {
  const list = (query = {}, actor = USER) => createListProcessesUseCase(fx.deps)(actor, FAMILY, MEMBER, query, CONTEXT);

  it("TC-PRC-15 ordena por openedAt desc e deriva familyStatus/nextStep da tabela de verdade", async () => {
    fx.addProcess({ id: "old", openedAt: new Date("2026-01-01T00:00:00Z"), phase: "NO_SHOW" });
    fx.addProcess({ id: "new", openedAt: new Date("2026-03-01T00:00:00Z"), phase: "PENDING" });
    const page = await list();
    expect(page.items.map((i) => i.id)).toEqual(["new", "old"]);
    expect(page.items[0]).toMatchObject({ familyStatus: "SCHEDULED", nextStep: { code: "AWAIT_CLINIC_RESPONSE", actor: "CLINIC" }, kind: "ROUTINE", memberId: MEMBER });
    expect(page.items[1]).toMatchObject({ familyStatus: "CANCELLED", nextStep: { code: "RESCHEDULE", actor: "FAMILY" } });
    expect(page.nextCursor).toBeNull();
  });

  it("TC-PRC-15 paginação por cursor sem duplicados, nextCursor nulo no fim", async () => {
    const ids = seedMany(7);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = await list({ limit: "3", ...(cursor ? { cursor } : {}) });
      seen.push(...page.items.map((i) => i.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(ids);
  });

  it("TC-PRC-15 filtro status é aplicado DEPOIS da derivação: 30 processos com 2 DONE devolvem os 2 seguindo nextCursor até nulo", async () => {
    seedMany(30, (index) => (index === 4 || index === 27 ? "DONE" : "SCHEDULED"));
    const found: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await list({ status: "DONE", limit: "1", ...(cursor ? { cursor } : {}) });
      found.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor && pages < 10);
    expect(found).toEqual(["p-004", "p-027"]);
  });

  it("TC-PRC-15 limite de varrimento: com 250 processos sem nenhum DONE, uma página varre no máx. 200 e nextCursor continua não nulo", async () => {
    seedMany(250);
    const page = await list({ status: "DONE", limit: "5" });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).not.toBeNull();
    expect(fx.facts.requests.flat()).toHaveLength(MAX_SCAN);
    const next = await list({ status: "DONE", limit: "5", cursor: page.nextCursor ?? "" });
    expect(next.nextCursor).toBeNull(); // restam 50: esgota
  });

  it("TC-PRC-15 filtro originType e limites: limit 0/101 => VALIDATION_ERROR; cursor inválido => MALFORMED_REQUEST", async () => {
    fx.addProcess({ id: "a", openedAt: NOW, originType: "APPOINTMENT" });
    fx.addProcess({ id: "e", openedAt: NOW, originType: "EXAMINATION" });
    expect((await list({ originType: "EXAMINATION" })).items.map((i) => i.id)).toEqual(["e"]);
    await expect(list({ limit: "0" })).rejects.toBeInstanceOf(ValidationError);
    await expect(list({ limit: "101" })).rejects.toBeInstanceOf(ValidationError);
    await expect(list({ status: "FOO" })).rejects.toBeInstanceOf(ValidationError);
    await expect(list({ cursor: "%%%" })).rejects.toMatchObject({ code: "MALFORMED_REQUEST" });
  });

  it("TC-PRC-23 processo sem ato legível é omitido da lista e sinalizado; nunca erro", async () => {
    fx.addProcess({ id: "ok", openedAt: NOW });
    fx.addProcess({ id: "orphan", openedAt: new Date(NOW.getTime() - 1000), phase: null });
    const page = await list();
    expect(page.items.map((i) => i.id)).toEqual(["ok"]);
    expect(fx.inconsistencies).toEqual([{ processId: "orphan", originType: "APPOINTMENT" }]);
  });

  it("TC-AZ-PRC-01 a lista filtra por categoria: sem EXAMS só consultas; sem nenhuma categoria => [] sem consultar a BD", async () => {
    fx.addProcess({ id: "a", openedAt: NOW, originType: "APPOINTMENT" });
    fx.addProcess({ id: "e", openedAt: NOW, originType: "EXAMINATION" });
    fx.policy.deniedCategories.add("EXAMS");
    expect((await list()).items.map((i) => i.id)).toEqual(["a"]);
    fx.policy.deniedCategories.add("APPOINTMENTS");
    fx.facts.requests.length = 0;
    expect(await list()).toEqual({ items: [], nextCursor: null });
    expect(fx.facts.requests).toHaveLength(0);
  });

  it("TC-AZ-PRC-06 a política é chamada uma vez por categoria (READ) e o Platform Admin recebe 404", async () => {
    await list();
    expect(fx.policy.calls.map((c) => [c.action, c.category, c.subjectMemberId])).toEqual([["READ", "APPOINTMENTS", MEMBER], ["READ", "EXAMS", MEMBER]]);
    await expect(list({}, { userId: "admin", platformAdmin: true })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("TC-PRC-22 NOT_FOUND e MEMBER_BLOCKED da política propagam", async () => {
    fx.policy.denyWith = new DomainError("MEMBER_BLOCKED");
    await expect(list()).rejects.toMatchObject({ code: "MEMBER_BLOCKED" });
    fx.policy.denyWith = new NotFoundError();
    await expect(list()).rejects.toBeInstanceOf(NotFoundError);
  });

  it.each<[Relation, boolean]>([["SELF", false], ["DEPENDENT_SELF", false], ["TUTOR_OF", true], ["OTHER", true]])("TC-PRC-21 PROCESS_VIEW (lista) para %s: auditado=%s, só com count", async (relation, audited) => {
    fx.policy.relation = relation;
    fx.addProcess({ id: "a", openedAt: NOW });
    await list();
    expect(fx.audit.events).toHaveLength(audited ? 1 : 0);
    if (audited) {
      expect(fx.audit.events[0]).toMatchObject({ action: "PROCESS_VIEW", actorType: "USER", actorUserId: "user-1", familyId: FAMILY, subjectMemberId: MEMBER, metadata: { count: 1 } });
      expect(fx.audit.events[0]?.resourceId).toBeUndefined();
    }
  });
});

describe("getProcess (UC-PRC-04, AC-PRC-06)", () => {
  const get = (processId: string, actor = USER) => createGetProcessUseCase(fx.deps)(actor, FAMILY, MEMBER, processId, CONTEXT);

  it("TC-PRC-16 devolve os campos do contrato e só valores do contrato (sem estados internos)", async () => {
    const scheduledAt = new Date("2026-07-01T09:00:00Z");
    fx.addProcess({ id: "p1", openedAt: NOW, originId: "appt-9", phase: "IN_PROGRESS" });
    fx.facts.seed("APPOINTMENT", "appt-9", { phase: "IN_PROGRESS", scheduledAt });
    const view = await get("p1");
    expect(view).toEqual({
      id: "p1",
      memberId: MEMBER,
      kind: "ROUTINE",
      familyStatus: "IN_PROGRESS",
      nextStep: { code: "BEING_ATTENDED", actor: "CLINIC" },
      origin: { type: "APPOINTMENT", id: "appt-9" },
      scheduledAt: scheduledAt.toISOString(),
      openedAt: NOW.toISOString(),
    });
    expect(JSON.stringify(view)).not.toMatch(/NO_SHOW|ARRIVED|REQUESTED/);
  });

  it("scheduledAt é null quando o ato não tem hora", async () => {
    fx.addProcess({ id: "p1", openedAt: NOW, originType: "EXAMINATION", phase: "DONE" });
    expect((await get("p1")).scheduledAt).toBeNull();
  });

  it("TC-AZ-PRC-02 inexistente, de outro membro/família e de categoria não legível => o mesmo NOT_FOUND", async () => {
    fx.addProcess({ id: "other-member", memberId: "member-2", openedAt: NOW });
    fx.addProcess({ id: "exam", originType: "EXAMINATION", openedAt: NOW });
    fx.policy.deniedCategories.add("EXAMS");
    const errors = await Promise.all(["missing", "other-member", "exam"].map((id) => get(id).catch((error: unknown) => error)));
    for (const error of errors) {
      expect(error).toBeInstanceOf(NotFoundError);
    }
    expect(new Set(errors.map((e) => (e as NotFoundError).detail)).size).toBe(1);
  });

  it("TC-PRC-23 processo sem ato legível => 404 e sinalizado", async () => {
    fx.addProcess({ id: "orphan", openedAt: NOW, phase: null });
    await expect(get("orphan")).rejects.toBeInstanceOf(NotFoundError);
    expect(fx.inconsistencies).toHaveLength(1);
  });

  it.each<[Relation, boolean]>([["SELF", false], ["TUTOR_OF", true], ["OTHER", true]])("TC-PRC-21 PROCESS_VIEW (detalhe) para %s: auditado=%s; 404 não audita", async (relation, audited) => {
    fx.policy.relation = relation;
    fx.addProcess({ id: "p1", openedAt: NOW });
    await get("p1");
    await get("nope").catch(() => undefined);
    expect(fx.audit.events).toHaveLength(audited ? 1 : 0);
    if (audited) expect(fx.audit.events[0]).toMatchObject({ action: "PROCESS_VIEW", resourceId: "p1", familyId: FAMILY, subjectMemberId: MEMBER });
    expect(JSON.stringify(fx.audit.events)).not.toMatch(/familyStatus|nextStep|phase|SCHEDULED/);
  });

  it("Platform Admin => 404 (sem enumeração)", async () => {
    fx.addProcess({ id: "p1", openedAt: NOW });
    await expect(get("p1", { userId: "admin", platformAdmin: true })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("getClinicProcess (UC-PRC-05, BR-PRC-06, AC-PRC-04)", () => {
  const actor = (role: ClinicPortalActor["role"], clinicId = "clinic-1"): ClinicPortalActor => ({ clinicAccountId: "acc-1", clinicId, role });
  const get = (processId: string, who = actor("CLINIC_ADMIN")) => createGetClinicProcessUseCase(fx.deps)(who, processId);

  it("TC-PRC-18 Admin e Gestor leem só o mínimo: sem ids Vita, familyStatus nem nextStep", async () => {
    fx.addProcess({ id: "p1", openedAt: NOW, clinicId: "clinic-1", originId: "appt-1", phase: "NO_SHOW" });
    for (const role of ["CLINIC_ADMIN", "CLINIC_MANAGER"] as const) {
      const view = await get("p1", actor(role));
      expect(view).toEqual({ id: "p1", kind: "ROUTINE", origin: { type: "APPOINTMENT", id: "appt-1" }, phase: "NO_SHOW", openedAt: NOW.toISOString() });
      expect(Object.keys(view).sort()).toEqual(["id", "kind", "openedAt", "origin", "phase"]);
    }
  });

  it("TC-AZ-PRC-03 outra clínica, sem clínica e inexistente => NOT_FOUND idêntico", async () => {
    fx.addProcess({ id: "other", openedAt: NOW, clinicId: "clinic-2" });
    fx.addProcess({ id: "no-clinic", openedAt: NOW });
    const errors = await Promise.all(["other", "no-clinic", "missing"].map((id) => get(id).catch((error: unknown) => error)));
    for (const error of errors) expect(error).toBeInstanceOf(NotFoundError);
    expect(new Set(errors.map((e) => (e as NotFoundError).detail)).size).toBe(1);
  });

  it("TC-AZ-PRC-04 o Médico => FORBIDDEN", async () => {
    fx.addProcess({ id: "p1", openedAt: NOW, clinicId: "clinic-1" });
    await expect(get("p1", actor("CLINIC_DOCTOR"))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a leitura da clínica não é auditada nem usa a AccessPolicy (ADR-020)", async () => {
    fx.addProcess({ id: "p1", openedAt: NOW, clinicId: "clinic-1" });
    await get("p1");
    expect(fx.audit.events).toHaveLength(0);
    expect(fx.policy.calls).toHaveLength(0);
  });
});
