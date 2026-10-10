// Job `notifications.send`: ST6 (retry/backoff), SKIPPED (conta suspensa, canal desativado, sem
// subscrição push), "falha de um canal não impede o outro" (BR-ALR-05).
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { defaultPreference } from "../domain/preference.js";
import { createEnqueueForAlertUseCase } from "./for-alerts.js";
import { createNotificationsFixtures, FAKE_TRX, type NotificationsFixtures } from "./fixtures.js";
import { createSendJobUseCase } from "./send-job.js";

const NOW = new Date("2026-10-10T08:00:00Z");

async function enqueueBothChannels(fx: NotificationsFixtures, alertId: string, userId: string): Promise<void> {
  const enqueueForAlert = createEnqueueForAlertUseCase(fx.deps);
  await enqueueForAlert(FAKE_TRX, { alertId, recipientUserId: userId });
}

describe("notifications.send", () => {
  let clock: FixedClock;
  let fx: NotificationsFixtures;

  beforeEach(() => {
    clock = new FixedClock(NOW);
    fx = createNotificationsFixtures(clock);
    fx.users.seed({ id: "user-1", status: "ACTIVE", email: "a@b.com", name: "A" });
  });

  it("envia e-mail e push com sucesso", async () => {
    await enqueueBothChannels(fx, "alert-1", "user-1");
    fx.pushSubscriptionsRepo.seed({ id: "sub-1", userId: "user-1", endpoint: "https://push/1", p256dh: "k", auth: "a", createdAt: NOW });

    const sendJob = createSendJobUseCase(fx.deps);
    const result = await sendJob();

    expect(result.sent).toBe(2);
    const statuses = [...fx.notificationsRepo.byId.values()].map((n) => n.status);
    expect(statuses).toEqual(["SENT", "SENT"]);
    expect(fx.mailer.sent).toHaveLength(1);
    expect(fx.pushSender.sent).toHaveLength(1);
    // N8/BR-ALR-08: texto genérico, sem nome/medicamento/hora.
    expect(fx.mailer.sent[0]?.body).not.toMatch(/toma|consulta|exame|medica/i);
  });

  it("SKIPPED: conta suspensa", async () => {
    fx.users.seed({ id: "user-1", status: "SUSPENDED", email: "a@b.com", name: "A" });
    await enqueueBothChannels(fx, "alert-1", "user-1");
    const sendJob = createSendJobUseCase(fx.deps);
    const result = await sendJob();
    expect(result.skipped).toBe(2);
    expect([...fx.notificationsRepo.byId.values()].every((n) => n.status === "SKIPPED" && n.lastErrorCode === "ACCOUNT_SUSPENDED")).toBe(true);
  });

  it("SKIPPED: canal desativado entre a criação e o envio", async () => {
    await enqueueBothChannels(fx, "alert-1", "user-1");
    fx.pushSubscriptionsRepo.seed({ id: "sub-1", userId: "user-1", endpoint: "https://push/1", p256dh: "k", auth: "a", createdAt: NOW });
    fx.preferencesRepo.seed({ ...defaultPreference("user-1"), emailEnabled: false });
    const sendJob = createSendJobUseCase(fx.deps);
    await sendJob();
    const email = [...fx.notificationsRepo.byId.values()].find((n) => n.channel === "EMAIL");
    const push = [...fx.notificationsRepo.byId.values()].find((n) => n.channel === "PUSH");
    expect(email?.status).toBe("SKIPPED");
    expect(email?.lastErrorCode).toBe("CHANNEL_DISABLED");
    // falha/skip de um canal não impede o outro (BR-ALR-05).
    expect(push?.status).toBe("SENT");
  });

  it("SKIPPED: push sem subscrição registada", async () => {
    await enqueueBothChannels(fx, "alert-1", "user-1");
    const sendJob = createSendJobUseCase(fx.deps);
    await sendJob();
    const push = [...fx.notificationsRepo.byId.values()].find((n) => n.channel === "PUSH");
    expect(push?.status).toBe("SKIPPED");
    expect(push?.lastErrorCode).toBe("NO_PUSH_SUBSCRIPTION");
  });

  it("ST6: retry com backoff (1, 5, 15, 60, 240 min) até ao máximo de 5 tentativas", async () => {
    await enqueueBothChannels(fx, "alert-1", "user-1");
    fx.mailer.shouldFail = true;
    const sendJob = createSendJobUseCase(fx.deps);

    const backoffMinutes = [1, 5, 15, 60, 240];
    for (const minutes of backoffMinutes) {
      const result = await sendJob();
      expect(result.retried + result.failedTerminal).toBeGreaterThanOrEqual(1);
      const email = [...fx.notificationsRepo.byId.values()].find((n) => n.channel === "EMAIL");
      expect(email?.status).toBe("FAILED");
      expect(email?.nextAttemptAt?.getTime()).toBe(clock.now().getTime() + minutes * 60_000);
      clock.advance(minutes * 60_000);
    }

    // 6ª tentativa (depois dos 5 retries): esgota, fica terminal sem novo agendamento.
    await sendJob();
    const email = [...fx.notificationsRepo.byId.values()].find((n) => n.channel === "EMAIL");
    expect(email?.status).toBe("FAILED");
    expect(email?.attempts).toBe(6);
    expect(email?.nextAttemptAt).toBeUndefined();

    // nunca mais é reselecionado (sem next_attempt_at, nunca <= now).
    clock.advance(365 * 24 * 60 * 60_000);
    const finalResult = await sendJob();
    expect(finalResult.sent + finalResult.retried + finalResult.skipped + finalResult.failedTerminal).toBe(0);
  });

  it("TC-ALR-08: subscrição push inválida/expirada (404/410) é removida", async () => {
    await enqueueBothChannels(fx, "alert-1", "user-1");
    fx.pushSubscriptionsRepo.seed({ id: "sub-1", userId: "user-1", endpoint: "https://push/expired", p256dh: "k", auth: "a", createdAt: NOW });
    fx.pushSender.nextResult = { delivered: false, invalidSubscription: true, errorCode: "HTTP_410" };

    const sendJob = createSendJobUseCase(fx.deps);
    await sendJob();

    expect(fx.pushSubscriptionsRepo.byId.has("sub-1")).toBe(false);
    const push = [...fx.notificationsRepo.byId.values()].find((n) => n.channel === "PUSH");
    expect(push?.status).toBe("FAILED"); // sem entrega bem-sucedida, entra em retry (ST6)
  });

  it("recupera (SENT) numa tentativa seguinte depois de uma falha", async () => {
    await enqueueBothChannels(fx, "alert-1", "user-1");
    fx.mailer.shouldFail = true;
    const sendJob = createSendJobUseCase(fx.deps);
    await sendJob();
    fx.mailer.shouldFail = false;
    clock.advance(60_000);
    await sendJob();
    const email = [...fx.notificationsRepo.byId.values()].find((n) => n.channel === "EMAIL");
    expect(email?.status).toBe("SENT");
  });
});
