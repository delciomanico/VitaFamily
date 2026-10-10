// API pública para `alerts` (modules.md §2 nota 15): isTypeEnabled, enqueueForAlert,
// skipPendingForAlert.
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { defaultPreference } from "../domain/preference.js";
import { createEnqueueForAlertUseCase, createIsTypeEnabledUseCase, createSkipPendingForAlertUseCase } from "./for-alerts.js";
import { createNotificationsFixtures, FAKE_TRX, type NotificationsFixtures } from "./fixtures.js";

const NOW = new Date("2026-10-10T08:00:00Z");

describe("isTypeEnabled", () => {
  let fx: NotificationsFixtures;
  beforeEach(() => {
    fx = createNotificationsFixtures(new FixedClock(NOW));
  });

  it("usa os defaults (R9) quando o utilizador não tem preferências próprias", async () => {
    const isTypeEnabled = createIsTypeEnabledUseCase(fx.deps);
    expect(await isTypeEnabled(FAKE_TRX, "user-1", "MEDICATION_DUE")).toBe(true);
  });

  it("respeita a preferência guardada (Q3: desativar tipo totalmente)", async () => {
    fx.preferencesRepo.seed({ ...defaultPreference("user-1"), medicationDue: false });
    const isTypeEnabled = createIsTypeEnabledUseCase(fx.deps);
    expect(await isTypeEnabled(FAKE_TRX, "user-1", "MEDICATION_DUE")).toBe(false);
    expect(await isTypeEnabled(FAKE_TRX, "user-1", "APPOINTMENT_REMINDER")).toBe(true);
  });
});

describe("enqueueForAlert (UC-ALR-01 pós-condição)", () => {
  let fx: NotificationsFixtures;
  beforeEach(() => {
    fx = createNotificationsFixtures(new FixedClock(NOW));
  });

  it("cria uma notification por canal ativo", async () => {
    const enqueueForAlert = createEnqueueForAlertUseCase(fx.deps);
    await enqueueForAlert(FAKE_TRX, { alertId: "alert-1", recipientUserId: "user-1" });
    const channels = [...fx.notificationsRepo.byId.values()].map((n) => n.channel).sort();
    expect(channels).toEqual(["EMAIL", "PUSH"]);
  });

  it("UC-ALR-02 alternativo: sem canal ativo, nenhuma notification é criada", async () => {
    fx.preferencesRepo.seed({ ...defaultPreference("user-1"), pushEnabled: false, emailEnabled: false });
    const enqueueForAlert = createEnqueueForAlertUseCase(fx.deps);
    await enqueueForAlert(FAKE_TRX, { alertId: "alert-1", recipientUserId: "user-1" });
    expect(fx.notificationsRepo.byId.size).toBe(0);
  });

  it("ADR-009: idempotente (UNIQUE alert_id,channel) — repetir não duplica", async () => {
    const enqueueForAlert = createEnqueueForAlertUseCase(fx.deps);
    await enqueueForAlert(FAKE_TRX, { alertId: "alert-1", recipientUserId: "user-1" });
    await enqueueForAlert(FAKE_TRX, { alertId: "alert-1", recipientUserId: "user-1" });
    expect(fx.notificationsRepo.byId.size).toBe(2);
  });
});

describe("skipPendingForAlert (UC-ALR-04, state-machines.md Notification SKIPPED)", () => {
  it("marca SKIPPED só as notificações ainda pendentes/falhadas desse alerta", async () => {
    const fx = createNotificationsFixtures(new FixedClock(NOW));
    const enqueueForAlert = createEnqueueForAlertUseCase(fx.deps);
    await enqueueForAlert(FAKE_TRX, { alertId: "alert-1", recipientUserId: "user-1" });
    for (const notificationId of fx.notificationsRepo.byId.keys()) {
      await fx.notificationsRepo.markSent(FAKE_TRX, notificationId, NOW);
    }
    await enqueueForAlert(FAKE_TRX, { alertId: "alert-2", recipientUserId: "user-1" });

    const skipPendingForAlert = createSkipPendingForAlertUseCase(fx.deps);
    await skipPendingForAlert(FAKE_TRX, "alert-1");
    await skipPendingForAlert(FAKE_TRX, "alert-2");

    const statuses = [...fx.notificationsRepo.byId.values()].map((n) => ({ alertId: n.alertId, status: n.status }));
    expect(statuses.filter((s) => s.alertId === "alert-1").every((s) => s.status === "SENT")).toBe(true); // já enviadas, não recuam
    expect(statuses.filter((s) => s.alertId === "alert-2").every((s) => s.status === "SKIPPED")).toBe(true);
  });
});
