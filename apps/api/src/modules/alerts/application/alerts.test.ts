// UC-ALR-03/04: listar (não lidos primeiro) e marcar como lido (um/todos).
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { NotFoundError } from "../../../platform/errors/index.js";
import type { Alert } from "../domain/alert.js";
import { createAlertsFixtures, type AlertsFixtures } from "./fixtures.js";
import { createListAlertsUseCase } from "./list-alerts.js";
import { createMarkAlertReadUseCase } from "./mark-alert-read.js";
import { createMarkAllAlertsReadUseCase } from "./mark-all-alerts-read.js";

const NOW = new Date("2026-10-10T08:00:00Z");

function seedAlert(fx: AlertsFixtures, overrides: Partial<Alert> = {}): Alert {
  const alert: Alert = {
    id: overrides.id ?? `alert-${String(fx.alertsRepo.byId.size + 1)}`,
    recipientUserId: "user-1",
    familyId: "fam-1",
    memberId: "member-1",
    type: "MEDICATION_DUE",
    sourceType: "DOSE",
    sourceId: "dose-1",
    ruleKey: "dose.due",
    dedupeKey: `dose.due:dose-1:user-1:${(overrides.triggerAt ?? NOW).toISOString()}`,
    triggerAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
  fx.alertsRepo.byId.set(alert.id, alert);
  fx.families.seedMember({ id: "member-1", familyId: "fam-1", name: "Membro", birthDate: "1990-01-01", isDependent: false, status: "ACTIVE", createdAt: NOW });
  return alert;
}

describe("listAlerts (UC-ALR-03)", () => {
  it("só devolve os alertas do destinatário, não lidos primeiro", async () => {
    const fx = createAlertsFixtures(new FixedClock(NOW));
    seedAlert(fx, { id: "a1", readAt: NOW, triggerAt: new Date(NOW.getTime() - 1000) });
    seedAlert(fx, { id: "a2" });
    seedAlert(fx, { id: "a3", recipientUserId: "other-user" });

    const listAlerts = createListAlertsUseCase(fx.deps);
    const page = await listAlerts("user-1", {});
    expect(page.items.map((a) => a.id)).toEqual(["a2", "a1"]);
    expect(page.items[0]?.memberName).toBe("Membro");
    expect(page.items[0]?.message).toBe("Hora de uma toma de medicação.");
  });

  it("filtra por unread=true", async () => {
    const fx = createAlertsFixtures(new FixedClock(NOW));
    seedAlert(fx, { id: "a1", readAt: NOW });
    seedAlert(fx, { id: "a2" });
    const listAlerts = createListAlertsUseCase(fx.deps);
    const page = await listAlerts("user-1", { unread: "true" });
    expect(page.items.map((a) => a.id)).toEqual(["a2"]);
  });
});

describe("markAlertRead (UC-ALR-04)", () => {
  let fx: AlertsFixtures;
  beforeEach(() => {
    fx = createAlertsFixtures(new FixedClock(NOW));
  });

  it("marca como lido e cancela notificações pendentes", async () => {
    seedAlert(fx, { id: "a1" });
    const markAlertRead = createMarkAlertReadUseCase(fx.deps);
    await markAlertRead("user-1", "a1");
    expect(fx.alertsRepo.byId.get("a1")?.readAt).toBeDefined();
    expect(fx.notifications.skipped).toEqual(["a1"]);
  });

  it("NOT_FOUND se o alerta não existe ou não é do destinatário", async () => {
    seedAlert(fx, { id: "a1", recipientUserId: "other-user" });
    const markAlertRead = createMarkAlertReadUseCase(fx.deps);
    await expect(markAlertRead("user-1", "a1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("é idempotente (marcar duas vezes não falha)", async () => {
    seedAlert(fx, { id: "a1" });
    const markAlertRead = createMarkAlertReadUseCase(fx.deps);
    await markAlertRead("user-1", "a1");
    await markAlertRead("user-1", "a1");
    expect(fx.notifications.skipped).toEqual(["a1", "a1"]);
  });
});

describe("markAllAlertsRead (UC-ALR-04)", () => {
  it("marca todos os não lidos do destinatário e cancela as suas notificações pendentes", async () => {
    const fx = createAlertsFixtures(new FixedClock(NOW));
    seedAlert(fx, { id: "a1" });
    seedAlert(fx, { id: "a2" });
    seedAlert(fx, { id: "a3", readAt: NOW });
    seedAlert(fx, { id: "a4", recipientUserId: "other-user" });

    const markAllAlertsRead = createMarkAllAlertsReadUseCase(fx.deps);
    await markAllAlertsRead("user-1");

    expect(fx.alertsRepo.byId.get("a1")?.readAt).toBeDefined();
    expect(fx.alertsRepo.byId.get("a2")?.readAt).toBeDefined();
    expect(fx.alertsRepo.byId.get("a4")?.readAt).toBeUndefined();
    expect(fx.notifications.skipped.sort()).toEqual(["a1", "a2"]);
  });
});
