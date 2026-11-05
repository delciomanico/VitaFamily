// D19/ADR-023: alertas de evento de exame (exam.cancelled|results) — no momento do
// evento, para os destinatários do sujeito (FR-ALR-08), idempotentes, sem conteúdo clínico (BR-ALR-08).
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createAlertsFixtures, type AlertsFixtures } from "./fixtures.js";
import { createRaiseExamEventUseCase } from "./raise-exam-event.js";

const NOW = new Date("2026-10-10T08:00:00Z");
const TRX = {};

describe("raiseExamEvent", () => {
  let fx: AlertsFixtures;
  let clock: FixedClock;

  beforeEach(() => {
    clock = new FixedClock(NOW);
    fx = createAlertsFixtures(clock);
    fx.families.seedMember({ id: "member-1", familyId: "fam-1", userId: "user-1", name: "Titular", birthDate: "1990-01-01", isDependent: false, status: "ACTIVE", createdAt: NOW });
  });

  it.each([
    ["EXAM_CANCELLED", "exam.cancelled"],
    ["EXAM_RESULTS_AVAILABLE", "exam.results"],
  ] as const)("%s cria o alerta %s para o titular e pede a notificação", async (type, ruleKey) => {
    const raise = createRaiseExamEventUseCase(fx.deps);
    expect(await raise(TRX, { type, examinationId: "exam-1", familyId: "fam-1", memberId: "member-1" })).toBe(1);

    const [alert] = [...fx.alertsRepo.byId.values()];
    expect(alert).toMatchObject({ type, ruleKey, sourceType: "EXAMINATION", sourceId: "exam-1", recipientUserId: "user-1", familyId: "fam-1", memberId: "member-1" });
    expect(alert?.triggerAt.toISOString()).toBe(NOW.toISOString());
    expect(fx.notifications.enqueued).toEqual([{ alertId: alert?.id, recipientUserId: "user-1" }]);
  });

  it("dependente sem conta notifica só os tutores; com o tipo desativado não cria alerta", async () => {
    fx.families.members.set("member-1", { id: "member-1", familyId: "fam-1", name: "Dependente", birthDate: "2015-01-01", isDependent: true, status: "ACTIVE", createdAt: NOW });
    fx.families.guardianUserIdsByDependent.set("member-1", ["tutor-1", "tutor-2"]);
    fx.notifications.disableType("tutor-2", "EXAM_CANCELLED");

    await createRaiseExamEventUseCase(fx.deps)(TRX, { type: "EXAM_CANCELLED", examinationId: "exam-1", familyId: "fam-1", memberId: "member-1" });

    expect([...fx.alertsRepo.byId.values()].map((a) => a.recipientUserId)).toEqual(["tutor-1"]);
  });

  it("o mesmo evento no mesmo instante é idempotente; um evento posterior cria novo alerta", async () => {
    const raise = createRaiseExamEventUseCase(fx.deps);
    const input = { type: "EXAM_CANCELLED", examinationId: "exam-1", familyId: "fam-1", memberId: "member-1" } as const;
    await raise(TRX, input);
    expect(await raise(TRX, input)).toBe(0);
    clock.advance(60_000);
    expect(await raise(TRX, input)).toBe(1);
    expect(fx.alertsRepo.byId.size).toBe(2);
  });

  it("membro inexistente -> nada criado", async () => {
    expect(await createRaiseExamEventUseCase(fx.deps)(TRX, { type: "EXAM_CANCELLED", examinationId: "exam-1", familyId: "fam-1", memberId: "nope" })).toBe(0);
  });
});
