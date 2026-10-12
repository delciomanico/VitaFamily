import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import type { ReadPage } from "../../../platform/reads/index.js";
import { createFamilyReportUseCase } from "./family-report.js";
import { createMemberReportUseCase } from "./member-report.js";
import type { ApiObject, ReportSources } from "./ports.js";

const ACTOR = { userId: "u1", platformAdmin: false };
const CTX = { requestId: "r1" };
const FAMILY = "f1";
const clock = { now: () => new Date("2026-10-12T10:00:00.000Z") };
const page = (items: ApiObject[]): ReadPage => ({ items, nextCursor: null });

interface Data {
  self: ApiObject[];
  appointments?: ApiObject[];
  exams?: ApiObject[];
  doses?: ApiObject[];
}

/** `denied` = membros cujas leituras lançam Forbidden (sem partilha). */
function sources(data: Data, denied: string[] = []): ReportSources {
  const guard = <T>(memberId: string, value: T): T => {
    if (denied.includes(memberId)) throw new ForbiddenError();
    return value;
  };
  return {
    listMembers: () => Promise.resolve(data.self),
    bloodType: (_a, _f, m) => Promise.resolve(guard(m, "A_POS")),
    allergies: (_a, _f, m) => Promise.resolve(guard(m, [{ id: "al1", name: "Penicilina" }])),
    conditions: (_a, _f, m) => Promise.resolve(guard(m, [{ id: "c1", name: "Asma", kind: "CONDITION" }, { id: "c2", name: "Fratura", kind: "HISTORY" }])),
    prescriptions: (_a, _f, m) => Promise.resolve(guard(m, page([{ id: "rx1", status: "COMPLETED", issuedOn: "2020-01-01" }, { id: "rx2", status: "COMPLETED", issuedOn: "2026-05-01" }]))),
    plans: (_a, _f, m) => Promise.resolve(guard(m, page([{ id: "p1", status: "ACTIVE" }]))),
    doses: (_a, _f, m) => Promise.resolve(guard(m, page(data.doses ?? []))),
    adherence: (_a, _f, m) => Promise.resolve(guard(m, [{ planId: "p1", taken: 3 }])),
    appointments: (_a, _f, m, q) =>
      Promise.resolve(
        guard(
          m,
          page((data.appointments ?? []).filter((a) => (q.from ? String(a.scheduledAt) >= q.from : true) && (q.to ? String(a.scheduledAt) <= q.to : true))),
        ),
      ),
    examinations: (_a, _f, m) => Promise.resolve(guard(m, page(data.exams ?? []))),
  };
}

const self = { id: "m1", name: "Eu", isSelf: true };
const other = { id: "m2", name: "Outro", isSelf: false };

describe("relatório individual (UC-RPT-01)", () => {
  it("devolve todas as secções ao titular, com período por defeito de 12 meses", async () => {
    const report = await createMemberReportUseCase({ sources: sources({ self: [self] }), clock })(ACTOR, FAMILY, "m1", {}, CTX);
    expect(report).toMatchObject({ from: "2025-10-12", to: "2026-10-12", member: self, bloodType: "A_POS" });
    expect(Object.keys(report)).toEqual(expect.arrayContaining(["allergies", "conditions", "prescriptions", "medicationPlans", "adherence", "appointments", "examinations"]));
  });

  it("só inclui receitas ativas ou do período", async () => {
    const report = await createMemberReportUseCase({ sources: sources({ self: [self] }), clock })(ACTOR, FAMILY, "m1", {}, CTX);
    expect((report.prescriptions ?? []).map((p) => p.id)).toEqual(["rx2"]);
  });

  it("omite secções sem permissão em vez de as devolver vazias (BR-RPT-01)", async () => {
    const partial = sources({ self: [self, other] });
    partial.allergies = () => Promise.reject(new ForbiddenError());
    const report = await createMemberReportUseCase({ sources: partial, clock })(ACTOR, FAMILY, "m2", {}, CTX);
    expect(report).not.toHaveProperty("allergies");
    expect(report).toHaveProperty("conditions");
  });

  it("sem nenhuma secção legível → NOT_FOUND (não revela o membro)", async () => {
    await expect(createMemberReportUseCase({ sources: sources({ self: [self, other] }, ["m2"]), clock })(ACTOR, FAMILY, "m2", {}, CTX)).rejects.toThrow(NotFoundError);
  });

  it("membro fora da família → NOT_FOUND", async () => {
    await expect(createMemberReportUseCase({ sources: sources({ self: [self] }), clock })(ACTOR, FAMILY, "zz", {}, CTX)).rejects.toThrow(NotFoundError);
  });

  it("período acima de 5 anos → VALIDATION_ERROR", async () => {
    await expect(createMemberReportUseCase({ sources: sources({ self: [self] }), clock })(ACTOR, FAMILY, "m1", { from: "2019-01-01", to: "2026-01-01" }, CTX)).rejects.toThrow(ValidationError);
  });
});

describe("visão familiar (UC-RPT-02)", () => {
  it("omite membros sem nenhuma informação visível (partilha)", async () => {
    const report = await createFamilyReportUseCase({ sources: sources({ self: [self, other] }, ["m2"]), clock })(ACTOR, FAMILY, CTX);
    expect(report.members.map((m) => m.member.id)).toEqual(["m1"]);
  });

  it("só condições (não histórico) e calcula itens pendentes", async () => {
    const report = await createFamilyReportUseCase({
      clock,
      sources: sources({
        self: [self],
        doses: [{ id: "d1", scheduledAt: "2026-10-11T08:00:00.000Z", status: "UNCONFIRMED" }],
        appointments: [
          { id: "a-past", scheduledAt: "2026-10-01T09:00:00.000Z", status: "SCHEDULED" },
          { id: "a-next", scheduledAt: "2026-10-20T09:00:00.000Z", status: "SCHEDULED" },
        ],
        exams: [
          { id: "e-past", examDate: "2026-10-05", status: "SCHEDULED" },
          { id: "e-next", examDate: "2026-11-05", status: "SCHEDULED" },
        ],
      }),
    })(ACTOR, FAMILY, CTX);
    const row = report.members[0];
    if (!row) throw new Error("membro em falta");
    expect(row.conditions).toEqual([{ id: "c1", name: "Asma", kind: "CONDITION" }]);
    expect((row.upcomingAppointments ?? []).map((a) => a.id)).toEqual(["a-next"]);
    expect((row.upcomingExaminations ?? []).map((e) => e.id)).toEqual(["e-next"]);
    expect(row.pending.map((p) => `${p.type}:${p.sourceId}`).sort()).toEqual(["APPOINTMENT_OUTCOME:a-past", "EXAM_OUTCOME:e-past", "UNCONFIRMED_DOSE:d1"]);
  });

  it("propaga erros que não são de permissão", async () => {
    const broken = sources({ self: [self] });
    broken.allergies = () => Promise.reject(new Error("db down"));
    await expect(createFamilyReportUseCase({ sources: broken, clock })(ACTOR, FAMILY, CTX)).rejects.toThrow("db down");
  });
});
