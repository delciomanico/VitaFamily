// TC-ALR-09/10/12 (ADR-036, BR-ALR-10..12): alertas `authorization.*` por transição, só SELF/TUTOR_OF, idempotentes, sem dados do pedido.
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createAlertsFixtures, type AlertsFixtures } from "./fixtures.js";
import { createListAlertsUseCase } from "./list-alerts.js";
import { createRaiseAuthorizationEventUseCase } from "./raise-authorization-event.js";

const NOW = new Date("2026-11-15T10:00:00Z");
const TRX = {};
const INPUT = { kind: "APPROVED", processId: "proc-1", requestId: "req-1", occurredAt: NOW } as const;

describe("raiseAuthorizationEvent", () => {
  let fx: AlertsFixtures;

  beforeEach(() => {
    fx = createAlertsFixtures(new FixedClock(NOW));
    fx.families.seedMember({ id: "member-1", familyId: "fam-1", userId: "user-1", name: "Titular", birthDate: "1990-01-01", isDependent: false, status: "ACTIVE", createdAt: NOW });
    fx.processes.seed({ processId: "proc-1", familyId: "fam-1", memberId: "member-1", open: true });
  });

  it.each([
    ["APPROVED", "AUTHORIZATION_APPROVED", "authorization.approved"],
    ["NOT_APPROVED", "AUTHORIZATION_NOT_APPROVED", "authorization.not_approved"],
    ["INFO_REQUESTED", "AUTHORIZATION_INFO_REQUESTED", "authorization.info_requested"],
    ["WITHDRAWN", "AUTHORIZATION_WITHDRAWN", "authorization.withdrawn"],
  ] as const)("TC-ALR-09 %s ⇒ um alerta %s (sourceType=PROCESS, sourceId=processId) e a notificação pedida", async (kind, type, ruleKey) => {
    expect(await createRaiseAuthorizationEventUseCase(fx.deps)(TRX, { ...INPUT, kind })).toBe(1);
    const [alert] = [...fx.alertsRepo.byId.values()];
    expect(alert).toMatchObject({ type, ruleKey, sourceType: "PROCESS", sourceId: "proc-1", recipientUserId: "user-1", familyId: "fam-1", memberId: "member-1", triggerAt: NOW });
    expect(alert?.dedupeKey).toBe(`${ruleKey}:proc-1:user-1:${NOW.toISOString()}`);
    expect(fx.notifications.enqueued).toEqual([{ alertId: alert?.id, recipientUserId: "user-1" }]);
  });

  it("TC-ALR-10 dependente (com ou sem conta): só os tutores com conta, nunca o dependente; 2 tutores ⇒ 2 alertas; sem destinatário ⇒ nenhum", async () => {
    fx.families.members.set("member-1", { id: "member-1", familyId: "fam-1", userId: "dep-user", name: "Dependente", birthDate: "2015-01-01", isDependent: true, status: "ACTIVE", createdAt: NOW });
    fx.families.guardianUserIdsByDependent.set("member-1", ["tutor-1", "tutor-2"]);
    expect(await createRaiseAuthorizationEventUseCase(fx.deps)(TRX, INPUT)).toBe(2);
    expect([...fx.alertsRepo.byId.values()].map((a) => a.recipientUserId).sort()).toEqual(["tutor-1", "tutor-2"]);

    fx.alertsRepo.byId.clear();
    fx.alertsRepo.byDedupeKey.clear();
    fx.notifications.enqueued.length = 0;
    fx.families.guardianUserIdsByDependent.set("member-1", []);
    expect(await createRaiseAuthorizationEventUseCase(fx.deps)(TRX, INPUT)).toBe(0);
    expect(fx.alertsRepo.byId.size).toBe(0);
    expect(fx.notifications.enqueued).toHaveLength(0);
  });

  it("BR-ALR-10 processo inexistente/apagado ou membro inexistente ⇒ sem alerta", async () => {
    const raise = createRaiseAuthorizationEventUseCase(fx.deps);
    expect(await raise(TRX, { ...INPUT, processId: "nope" })).toBe(0);
    fx.processes.seed({ processId: "proc-2", familyId: "fam-1", memberId: "ghost", open: true });
    expect(await raise(TRX, { ...INPUT, processId: "proc-2" })).toBe(0);
    expect(fx.alertsRepo.byId.size).toBe(0);
  });

  it("TC-ALR-12 idempotente no mesmo instante; aprovar, reverter e voltar a aprovar ⇒ alertas distintos por triggerAt", async () => {
    const raise = createRaiseAuthorizationEventUseCase(fx.deps);
    await raise(TRX, INPUT);
    expect(await raise(TRX, INPUT)).toBe(0);
    await raise(TRX, { ...INPUT, kind: "WITHDRAWN", occurredAt: new Date(NOW.getTime() + 60_000) });
    await raise(TRX, { ...INPUT, occurredAt: new Date(NOW.getTime() + 120_000) });
    expect([...fx.alertsRepo.byId.values()].map((a) => a.type)).toEqual(["AUTHORIZATION_APPROVED", "AUTHORIZATION_WITHDRAWN", "AUTHORIZATION_APPROVED"]);
    expect(fx.notifications.enqueued).toHaveLength(3);
  });

  it("TC-ALR-13 sem interruptor de tipo próprio: os canais mandam; a mensagem in-app é fixa e sem dados do pedido", async () => {
    await createRaiseAuthorizationEventUseCase(fx.deps)(TRX, INPUT);
    const list = await createListAlertsUseCase({ ...fx.deps, db: TRX })("user-1", {});
    expect(list.items[0]?.message).toBe("A seguradora aprovou um pedido.");
    // Tudo o que o alerta guarda: tipo/origem/ids (nunca clínica, serviço, valor, motivo nem estado).
    const alert = [...fx.alertsRepo.byId.values()][0];
    expect(Object.keys(alert ?? {}).sort()).toEqual(["createdAt", "dedupeKey", "familyId", "id", "memberId", "recipientUserId", "ruleKey", "sourceId", "sourceType", "triggerAt", "type"]);
  });
});
