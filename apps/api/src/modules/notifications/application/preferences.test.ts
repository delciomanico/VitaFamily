// UC-ALR-05: GET/PUT preferências.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createGetPreferencesUseCase } from "./get-preferences.js";
import { createPutPreferencesUseCase } from "./put-preferences.js";
import { createNotificationsFixtures } from "./fixtures.js";

const NOW = new Date("2026-10-10T08:00:00Z");

describe("getPreferences/putPreferences", () => {
  it("devolve os defaults (R9) sem linha própria", async () => {
    const fx = createNotificationsFixtures(new FixedClock(NOW));
    const getPreferences = createGetPreferencesUseCase(fx.deps);
    const pref = await getPreferences("user-1");
    expect(pref).toMatchObject({ pushEnabled: true, emailEnabled: true, medicationDue: true });
  });

  it("put só altera os campos enviados; persiste e get devolve o novo valor", async () => {
    const fx = createNotificationsFixtures(new FixedClock(NOW));
    const putPreferences = createPutPreferencesUseCase(fx.deps);
    const getPreferences = createGetPreferencesUseCase(fx.deps);

    await putPreferences("user-1", { medicationDue: false });
    const pref = await getPreferences("user-1");
    expect(pref.medicationDue).toBe(false);
    expect(pref.appointmentReminder).toBe(true); // Q3: desativar um tipo não afeta os outros
  });
});
