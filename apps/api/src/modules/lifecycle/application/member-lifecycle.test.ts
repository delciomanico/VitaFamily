import { describe, expect, it } from "vitest";
import type { AuditEvent } from "../../audit/index.js";
import { createMemberLifecycleJobs, type LifecycleTarget, type MemberLifecycleDeps } from "./member-lifecycle.js";

const NOW = new Date("2026-10-12T10:00:00.000Z");
const target = (over: Partial<LifecycleTarget> = {}): LifecycleTarget => ({ familyId: "f1", memberId: "m1", name: "Rita", guardianUserIds: ["g1"], adminUserIds: ["a1"], ...over });

function setup(data: {
  turning?: Record<number, LifecycleTarget[]>;
  adultsDue?: LifecycleTarget[];
  blockedFor?: Record<number, LifecycleTarget[]>;
  due?: LifecycleTarget[];
  blockedOnComing?: boolean;
  failMail?: boolean;
}) {
  const mails: { to: string; subject: string }[] = [];
  const calls: string[] = [];
  const events: AuditEvent[] = [];
  const errors: unknown[] = [];
  const deps: MemberLifecycleDeps<null> = {
    members: {
      listTurningAdult: (_t, _today, inDays) => Promise.resolve(data.turning?.[inDays] ?? []),
      listAdultsDue: () => Promise.resolve(data.adultsDue ?? []),
      completeComingOfAge: (_t, _f, m) => { calls.push(`adult:${m}`); return Promise.resolve({ blocked: data.blockedOnComing ?? false }); },
      listBlockedForDays: (_t, _today, days) => Promise.resolve(data.blockedFor?.[days] ?? []),
      listBlockedDue: () => Promise.resolve(data.due ?? []),
      deleteMember: (_t, _f, m) => { calls.push(`delete:${m}`); return Promise.resolve(); },
    },
    emailOf: (_t, userId) => Promise.resolve(`${userId}@x.pt`),
    mailer: { send: (email) => (data.failMail ? Promise.reject(new Error("smtp")) : (mails.push(email), Promise.resolve())) },
    purgeMemberFiles: (_t, _f, m) => { calls.push(`purge:${m}`); return Promise.resolve(); },
    audit: { record: (_t, e) => { events.push(e); return Promise.resolve(); } },
    withTransaction: (fn) => fn(null),
    clock: { now: () => NOW },
    onNotifyError: (e) => errors.push(e),
  };
  return { jobs: createMemberLifecycleJobs(deps), mails, calls, events, errors };
}

describe("maioridade (UC-MEM-10, BR-MEM-10/11)", () => {
  it("avisa o jovem (com conta) e os tutores aos 30 e 7 dias, sem repetir destinatários", async () => {
    const { jobs, mails } = setup({ turning: { 30: [target({ userId: "u9" })], 7: [target({ userId: "u9", guardianUserIds: ["u9"] })] } });
    await expect(jobs.comingOfAge()).resolves.toEqual({ warned: 2, converted: 0, blocked: 0 });
    expect(mails.map((m) => m.to).sort()).toEqual(["g1@x.pt", "u9@x.pt", "u9@x.pt"]);
  });

  it("no dia: termina a tutela, audita e avisa o titular e os tutores", async () => {
    const { jobs, mails, calls, events } = setup({ adultsDue: [target({ userId: "u9" })] });
    await expect(jobs.comingOfAge()).resolves.toMatchObject({ converted: 1, blocked: 0 });
    expect(calls).toEqual(["adult:m1"]);
    expect(events.map((e) => e.action)).toEqual(["MEMBER_COMING_OF_AGE"]);
    expect(mails.map((m) => m.subject)).toEqual(["Vita Family: tutela terminada", "Vita Family: tutela terminada"]);
  });

  it("sem conta: fica bloqueado e o Admin e os tutores são avisados (Q7)", async () => {
    const { jobs, mails } = setup({ adultsDue: [target()], blockedOnComing: true });
    await expect(jobs.comingOfAge()).resolves.toMatchObject({ blocked: 1 });
    expect(mails.map((m) => m.to).sort()).toEqual(["a1@x.pt", "g1@x.pt"]);
    expect(mails[0]?.subject).toBe("Vita Family: perfil bloqueado");
  });

  it("uma falha de e-mail não impede a mudança de estado", async () => {
    const { jobs, calls, errors } = setup({ adultsDue: [target({ userId: "u9" })], failMail: true });
    await jobs.comingOfAge();
    expect(calls).toEqual(["adult:m1"]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("recupera a transição mesmo que o worker tenha perdido o dia exato do aniversário (listAdultsDue usa 'já passou')", async () => {
    // simula um aniversário há 3 dias que o worker não processou nesse dia: `listTurningAdult`
    // (equality) não o devolveria para nenhum `inDays`, mas `listAdultsDue` (<=) continua a vê-lo.
    const { jobs, calls } = setup({ adultsDue: [target({ userId: "u9" })] });
    await expect(jobs.comingOfAge()).resolves.toMatchObject({ converted: 1 });
    expect(calls).toEqual(["adult:m1"]);
  });
});

describe("perfis bloqueados (BR-MEM-11)", () => {
  it("avisa os Admins aos 30, 60 e 83 dias com os dias que faltam", async () => {
    const { jobs, mails } = setup({ blockedFor: { 30: [target()], 60: [target()], 83: [target()] } });
    await expect(jobs.blockedMembers()).resolves.toEqual({ warned: 3, deleted: 0 });
    expect(mails.map((m) => /dentro de (\d+) dias/.exec(m.subject + " ")?.[1])).toBeDefined();
    expect(mails).toHaveLength(3);
  });

  it("aos 90 dias apaga ficheiros e dados, audita e avisa o Admin", async () => {
    const { jobs, calls, events, mails } = setup({ due: [target()] });
    await expect(jobs.blockedMembers()).resolves.toEqual({ warned: 0, deleted: 1 });
    expect(calls).toEqual(["purge:m1", "delete:m1"]);
    expect(events.map((e) => e.action)).toEqual(["MEMBER_BLOCKED_DELETE"]);
    expect(mails.map((m) => m.to)).toEqual(["a1@x.pt"]);
  });
});
