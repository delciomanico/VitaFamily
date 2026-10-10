import { describe, expect, it } from "vitest";
import {
  appointmentOutcomeRule,
  appointmentReminderRules,
  buildDedupeKey,
  doseRules,
  examReminderRule,
} from "./rule.js";

describe("doseRules (BR-ALR-03/Q3: no horário; +15 min)", () => {
  it("dose.due no horário exato; dose.repeat 15 min depois", () => {
    const scheduledAt = new Date("2026-10-10T08:00:00Z");
    const [due, repeat] = doseRules(scheduledAt);
    expect(due).toEqual({ ruleKey: "dose.due", type: "MEDICATION_DUE", triggerAt: scheduledAt });
    expect(repeat?.triggerAt.toISOString()).toBe("2026-10-10T08:15:00.000Z");
  });
});

describe("appointmentReminderRules (BR-APT-03/BR-APT-05: 24h e 2h fixos)", () => {
  it("24h e 2h antes do horário da consulta", () => {
    const scheduledAt = new Date("2026-10-11T10:00:00Z");
    const rules = appointmentReminderRules(scheduledAt);
    expect(rules[0]?.ruleKey).toBe("appointment.24h");
    expect(rules[0]?.triggerAt.toISOString()).toBe("2026-10-10T10:00:00.000Z");
    expect(rules[1]?.ruleKey).toBe("appointment.2h");
    expect(rules[1]?.triggerAt.toISOString()).toBe("2026-10-11T08:00:00.000Z");
  });
});

describe("appointmentOutcomeRule (BR-APT-02/Q4: +24h depois de passada)", () => {
  it("dispara 24h depois do horário agendado", () => {
    const scheduledAt = new Date("2026-10-09T09:00:00Z");
    const rule = appointmentOutcomeRule(scheduledAt);
    expect(rule.ruleKey).toBe("appointment.outcome");
    expect(rule.triggerAt.toISOString()).toBe("2026-10-10T09:00:00.000Z");
  });
});

describe("examReminderRule (BR-EXM-03: 24h antes)", () => {
  it("24h antes do instante dado (meia-noite local já resolvida por quem chama)", () => {
    const examMidnightUtc = new Date("2026-10-15T00:00:00Z");
    const rule = examReminderRule(examMidnightUtc);
    expect(rule.ruleKey).toBe("exam.24h");
    expect(rule.triggerAt.toISOString()).toBe("2026-10-14T00:00:00.000Z");
  });
});

describe("buildDedupeKey (ADR-009: idempotente; BR-APT-03 recalcula ao editar)", () => {
  it("é determinístico para os mesmos valores", () => {
    const triggerAt = new Date("2026-10-10T08:00:00Z");
    const a = buildDedupeKey("dose.due", "dose-1", "user-1", triggerAt);
    const b = buildDedupeKey("dose.due", "dose-1", "user-1", triggerAt);
    expect(a).toBe(b);
  });

  it("muda se o triggerAt mudar (reagendar produz uma chave nova, nunca bloqueada pela antiga)", () => {
    const a = buildDedupeKey("appointment.24h", "apt-1", "user-1", new Date("2026-10-10T08:00:00Z"));
    const b = buildDedupeKey("appointment.24h", "apt-1", "user-1", new Date("2026-10-12T08:00:00Z"));
    expect(a).not.toBe(b);
  });

  it("muda por destinatário (um alerta por recipient, FR-ALR-08)", () => {
    const triggerAt = new Date("2026-10-10T08:00:00Z");
    const a = buildDedupeKey("dose.due", "dose-1", "user-1", triggerAt);
    const b = buildDedupeKey("dose.due", "dose-1", "user-2", triggerAt);
    expect(a).not.toBe(b);
  });
});
