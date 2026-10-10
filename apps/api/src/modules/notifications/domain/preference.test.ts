import { describe, expect, it } from "vitest";
import { activeChannels, applyPreferenceChanges, defaultPreference, isTypeEnabled } from "./preference.js";

describe("defaultPreference (R9)", () => {
  it("todos os canais e tipos a verdadeiro por omissão", () => {
    const pref = defaultPreference("user-1");
    expect(pref).toEqual({
      userId: "user-1",
      pushEnabled: true,
      emailEnabled: true,
      medicationDue: true,
      appointmentReminder: true,
      examReminder: true,
    });
  });
});

describe("isTypeEnabled (Q3/UC-ALR-05)", () => {
  it.each([
    ["MEDICATION_DUE", "medicationDue"],
    ["APPOINTMENT_REMINDER", "appointmentReminder"],
    ["APPOINTMENT_OUTCOME_REQUEST", "appointmentReminder"],
    ["EXAM_REMINDER", "examReminder"],
  ] as const)("%s depende de preference.%s", (type, field) => {
    const enabled = defaultPreference("u");
    expect(isTypeEnabled(enabled, type)).toBe(true);
    const disabled = applyPreferenceChanges(enabled, { [field]: false });
    expect(isTypeEnabled(disabled, type)).toBe(false);
  });
});

describe("activeChannels (UC-ALR-02)", () => {
  it("devolve só os canais ativos", () => {
    const both = defaultPreference("u");
    expect(activeChannels(both)).toEqual(["PUSH", "EMAIL"]);

    const pushOnly = applyPreferenceChanges(both, { emailEnabled: false });
    expect(activeChannels(pushOnly)).toEqual(["PUSH"]);

    const none = applyPreferenceChanges(both, { pushEnabled: false, emailEnabled: false });
    expect(activeChannels(none)).toEqual([]);
  });
});
