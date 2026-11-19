// Alertas `booking.updated` e `payment.updated` (BR-MKT-65): criação idempotente por (regra, marcação, destinatário, versão do estado), destinatários SELF/TUTOR_OF e texto genérico (sem conteúdo livre no alerta).
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { buildBookingDedupeKey } from "../domain/rule.js";
import { createAlertsFixtures, type AlertsFixtures } from "./fixtures.js";
import { createRaiseBookingEventUseCase, type RaiseBookingEventInput } from "./raise-booking-event.js";

const NOW = new Date("2026-11-10T08:00:00Z");
const TRX = {};
const INPUT: RaiseBookingEventInput = { kind: "BOOKING_UPDATED", bookingId: "bk-1", familyId: "fam-1", memberId: "member-1", stateVersion: "2026-11-10T08:00:00.000Z" };
const ALERT_KEYS = ["createdAt", "dedupeKey", "familyId", "id", "memberId", "recipientUserId", "ruleKey", "sourceId", "sourceType", "triggerAt", "type"];

describe("buildBookingDedupeKey", () => {
  it("devolve ruleKey:marcação:destinatário:versão", () => {
    expect(buildBookingDedupeKey("booking.updated", "bk-1", "user-1", "v1")).toBe("booking.updated:bk-1:user-1:v1");
  });
});

describe("raiseBookingEvent", () => {
  let clock: FixedClock;
  let fx: AlertsFixtures;

  beforeEach(() => {
    clock = new FixedClock(NOW);
    fx = createAlertsFixtures(clock);
    fx.families.seedMember({ id: "member-1", familyId: "fam-1", userId: "user-1", name: "Titular", birthDate: "1990-01-01", isDependent: false, status: "ACTIVE", createdAt: NOW });
  });

  it("BOOKING_UPDATED cria 1 alerta para o titular (booking.updated, origem BOOKING = marcação) e pede a notificação", async () => {
    expect(await createRaiseBookingEventUseCase(fx.deps)(TRX, INPUT)).toBe(1);
    const [alert] = [...fx.alertsRepo.byId.values()];
    if (!alert) throw new Error("alerta esperado");
    expect(alert).toMatchObject({ type: "BOOKING_UPDATED", ruleKey: "booking.updated", sourceType: "BOOKING", sourceId: "bk-1", recipientUserId: "user-1", familyId: "fam-1", memberId: "member-1" });
    expect(fx.notifications.enqueued).toEqual([{ alertId: alert.id, recipientUserId: "user-1" }]);
  });

  it("PAYMENT_UPDATED cria PAYMENT_UPDATED (payment.updated) para o titular", async () => {
    expect(await createRaiseBookingEventUseCase(fx.deps)(TRX, { ...INPUT, kind: "PAYMENT_UPDATED" })).toBe(1);
    const [alert] = [...fx.alertsRepo.byId.values()];
    expect(alert).toMatchObject({ type: "PAYMENT_UPDATED", ruleKey: "payment.updated", sourceType: "BOOKING", sourceId: "bk-1", recipientUserId: "user-1" });
  });

  it("dependente com conta: só os tutores recebem, sem repetir tutores e nunca o dependente", async () => {
    fx.families.members.set("member-1", { id: "member-1", familyId: "fam-1", userId: "dep-user", name: "Dependente", birthDate: "2015-01-01", isDependent: true, status: "ACTIVE", createdAt: NOW });
    fx.families.guardianUserIdsByDependent.set("member-1", ["tutor-1", "tutor-2", "tutor-1"]);
    expect(await createRaiseBookingEventUseCase(fx.deps)(TRX, INPUT)).toBe(2);
    expect([...fx.alertsRepo.byId.values()].map((a) => a.recipientUserId).sort()).toEqual(["tutor-1", "tutor-2"]);
  });

  it("dedupeKey: mesma versão do estado não cria segundo alerta (noutro instante); nova versão cria novo", async () => {
    const raise = createRaiseBookingEventUseCase(fx.deps);
    expect(await raise(TRX, INPUT)).toBe(1);
    clock.advance(60 * 60 * 1000);
    expect(await raise(TRX, INPUT)).toBe(0);
    expect(fx.alertsRepo.byId.size).toBe(1);
    expect(await raise(TRX, { ...INPUT, stateVersion: "2026-11-10T09:00:00.000Z" })).toBe(1);
    expect(fx.alertsRepo.byId.size).toBe(2);
    expect([...fx.alertsRepo.byDedupeKey.keys()].sort()).toEqual([
      "booking.updated:bk-1:user-1:2026-11-10T08:00:00.000Z",
      "booking.updated:bk-1:user-1:2026-11-10T09:00:00.000Z",
    ]);
  });

  it("BOOKING_UPDATED e PAYMENT_UPDATED com a mesma versão criam alertas distintos", async () => {
    const raise = createRaiseBookingEventUseCase(fx.deps);
    expect(await raise(TRX, INPUT)).toBe(1);
    expect(await raise(TRX, { ...INPUT, kind: "PAYMENT_UPDATED" })).toBe(1);
    expect(fx.alertsRepo.byId.size).toBe(2);
    expect([...fx.alertsRepo.byId.values()].map((a) => a.type).sort()).toEqual(["BOOKING_UPDATED", "PAYMENT_UPDATED"]);
  });

  it("destinatário com o tipo desativado não recebe alerta nem notificação", async () => {
    fx.notifications.disableType("user-1", "BOOKING_UPDATED");
    expect(await createRaiseBookingEventUseCase(fx.deps)(TRX, INPUT)).toBe(0);
    expect(fx.alertsRepo.byId.size).toBe(0);
    expect(fx.notifications.enqueued).toEqual([]);
  });

  it("membro inexistente devolve 0 e não cria nada", async () => {
    expect(await createRaiseBookingEventUseCase(fx.deps)(TRX, { ...INPUT, memberId: "nope" })).toBe(0);
    expect(fx.alertsRepo.byId.size).toBe(0);
    expect(fx.notifications.enqueued).toEqual([]);
  });

  it("o alerta não contém texto livre: só as chaves esperadas (sem nome, hora, valor ou motivo)", async () => {
    await createRaiseBookingEventUseCase(fx.deps)(TRX, INPUT);
    const [alert] = [...fx.alertsRepo.byId.values()];
    if (!alert) throw new Error("alerta esperado");
    expect(Object.keys(alert).sort()).toEqual(ALERT_KEYS);
  });
});
