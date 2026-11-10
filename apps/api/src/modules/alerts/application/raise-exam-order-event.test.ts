// ADR-028 (BR-CLN-53): alerta `exam_order.added` genérico, só SELF/TUTOR_OF, idempotente, sem conteúdo clínico (BR-HLT-05).
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { resolveExamOrderRecipients } from "../domain/recipients.js";
import { createAlertsFixtures, type AlertsFixtures } from "./fixtures.js";
import { createRaiseExamOrderEventUseCase } from "./raise-exam-order-event.js";

const NOW = new Date("2026-11-10T08:00:00Z");
const TRX = {};
const INPUT = { appointmentId: "apt-1", familyId: "fam-1", memberId: "member-1" };

describe("resolveExamOrderRecipients", () => {
  it.each([
    [{ userId: "u1", isDependent: false }, ["t1"], ["u1"]],
    [{ isDependent: false }, ["t1"], []],
    [{ userId: "dep-user", isDependent: true }, ["t1", "t2", "t1"], ["t1", "t2"]],
    [{ isDependent: true }, [], []],
  ])("%j + tutores %j => %j (nunca o dependente com conta)", (member, guardians, expected) => {
    expect(resolveExamOrderRecipients(member, guardians)).toEqual(expected);
  });
});

describe("raiseExamOrderEvent", () => {
  let fx: AlertsFixtures;

  beforeEach(() => {
    fx = createAlertsFixtures(new FixedClock(NOW));
    fx.families.seedMember({ id: "member-1", familyId: "fam-1", userId: "user-1", name: "Titular", birthDate: "1990-01-01", isDependent: false, status: "ACTIVE", createdAt: NOW });
  });

  it("cria EXAM_ORDER_ADDED (exam_order.added, source APPOINTMENT) para o titular e pede a notificação", async () => {
    expect(await createRaiseExamOrderEventUseCase(fx.deps)(TRX, INPUT)).toBe(1);
    const [alert] = [...fx.alertsRepo.byId.values()];
    expect(alert).toMatchObject({ type: "EXAM_ORDER_ADDED", ruleKey: "exam_order.added", sourceType: "APPOINTMENT", sourceId: "apt-1", recipientUserId: "user-1", familyId: "fam-1", memberId: "member-1" });
    expect(fx.notifications.enqueued).toEqual([{ alertId: alert?.id, recipientUserId: "user-1" }]);
  });

  it("dependente com conta: só os tutores recebem (DEPENDENT_SELF não lê os pedidos)", async () => {
    fx.families.members.set("member-1", { id: "member-1", familyId: "fam-1", userId: "dep-user", name: "Dependente", birthDate: "2015-01-01", isDependent: true, status: "ACTIVE", createdAt: NOW });
    fx.families.guardianUserIdsByDependent.set("member-1", ["tutor-1", "tutor-2"]);
    await createRaiseExamOrderEventUseCase(fx.deps)(TRX, INPUT);
    expect([...fx.alertsRepo.byId.values()].map((a) => a.recipientUserId).sort()).toEqual(["tutor-1", "tutor-2"]);
  });

  it("idempotente no mesmo instante; membro inexistente não cria nada", async () => {
    const raise = createRaiseExamOrderEventUseCase(fx.deps);
    await raise(TRX, INPUT);
    expect(await raise(TRX, INPUT)).toBe(0);
    expect(await raise(TRX, { ...INPUT, memberId: "nope" })).toBe(0);
    expect(fx.alertsRepo.byId.size).toBe(1);
  });
});
