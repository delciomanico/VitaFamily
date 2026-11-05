// D19/ADR-023 (BR-CLN-09): alerta `recommendation.added` no momento da emissão, para os
// destinatários do sujeito (UC-ALR-05), idempotente, sem conteúdo clínico (BR-HLT-05/BR-ALR-08).
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createAlertsFixtures, type AlertsFixtures } from "./fixtures.js";
import { createRaiseRecommendationEventUseCase } from "./raise-recommendation-event.js";

const NOW = new Date("2026-10-10T08:00:00Z");
const TRX = {};
const INPUT = { recommendationId: "rec-1", familyId: "fam-1", memberId: "member-1" };

describe("raiseRecommendationEvent", () => {
  let fx: AlertsFixtures;
  let clock: FixedClock;

  beforeEach(() => {
    clock = new FixedClock(NOW);
    fx = createAlertsFixtures(clock);
    fx.families.seedMember({ id: "member-1", familyId: "fam-1", userId: "user-1", name: "Titular", birthDate: "1990-01-01", isDependent: false, status: "ACTIVE", createdAt: NOW });
  });

  it("cria RECOMMENDATION_ADDED (recommendation.added, source RECOMMENDATION) para o titular e pede a notificação", async () => {
    expect(await createRaiseRecommendationEventUseCase(fx.deps)(TRX, INPUT)).toBe(1);
    const [alert] = [...fx.alertsRepo.byId.values()];
    expect(alert).toMatchObject({ type: "RECOMMENDATION_ADDED", ruleKey: "recommendation.added", sourceType: "RECOMMENDATION", sourceId: "rec-1", recipientUserId: "user-1", familyId: "fam-1", memberId: "member-1" });
    expect(alert?.triggerAt.toISOString()).toBe(NOW.toISOString());
    expect(fx.notifications.enqueued).toEqual([{ alertId: alert?.id, recipientUserId: "user-1" }]);
    // BR-HLT-05: o alerta não guarda nenhum campo de texto da recomendação.
    expect(Object.keys(alert ?? {}).sort()).not.toContain("text");
  });

  it("dependente sem conta notifica só os tutores com o tipo ativo", async () => {
    fx.families.members.set("member-1", { id: "member-1", familyId: "fam-1", name: "Dependente", birthDate: "2015-01-01", isDependent: true, status: "ACTIVE", createdAt: NOW });
    fx.families.guardianUserIdsByDependent.set("member-1", ["tutor-1", "tutor-2"]);
    fx.notifications.disableType("tutor-2", "RECOMMENDATION_ADDED");

    await createRaiseRecommendationEventUseCase(fx.deps)(TRX, INPUT);

    expect([...fx.alertsRepo.byId.values()].map((a) => a.recipientUserId)).toEqual(["tutor-1"]);
  });

  it("o mesmo evento no mesmo instante é idempotente; membro inexistente não cria nada", async () => {
    const raise = createRaiseRecommendationEventUseCase(fx.deps);
    await raise(TRX, INPUT);
    expect(await raise(TRX, INPUT)).toBe(0);
    expect(await raise(TRX, { ...INPUT, memberId: "nope" })).toBe(0);
    expect(fx.alertsRepo.byId.size).toBe(1);
  });
});
