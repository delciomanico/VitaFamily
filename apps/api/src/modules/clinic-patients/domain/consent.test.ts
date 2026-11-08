// AC-CLN-16 / TC-CLN-11: nível efetivo do consentimento e validade de 12 meses (BR-CLN-19).
import { describe, expect, it } from "vitest";
import { ValidationError } from "../../../platform/errors/index.js";
import { effectiveConsent, historyValidUntil, parseConsentLevel } from "./consent.js";

const NOW = new Date("2026-11-08T10:00:00.000Z");

describe("historyValidUntil", () => {
  it("agora + 12 meses civis", () => {
    expect(historyValidUntil(NOW).toISOString()).toBe("2027-11-08T10:00:00.000Z");
  });
});

describe("effectiveConsent", () => {
  const until = new Date("2027-11-08T10:00:00.000Z");
  it("HISTORY válido => HISTORY até validUntil", () => {
    expect(effectiveConsent({ level: "HISTORY", historyValidUntil: until }, NOW)).toEqual({ level: "HISTORY", validUntil: until, renewalNeeded: false });
  });
  it("HISTORY expirado (exatamente no instante) => BOOKINGS com renewalNeeded", () => {
    expect(effectiveConsent({ level: "HISTORY", historyValidUntil: until }, until)).toEqual({ level: "BOOKINGS", validUntil: null, renewalNeeded: true });
    expect(effectiveConsent({ level: "HISTORY", historyValidUntil: until }, new Date(until.getTime() + 1))).toMatchObject({ level: "BOOKINGS", renewalNeeded: true });
  });
  it("BOOKINGS não expira", () => {
    expect(effectiveConsent({ level: "BOOKINGS" }, new Date("2099-01-01T00:00:00Z"))).toEqual({ level: "BOOKINGS", validUntil: null, renewalNeeded: false });
  });
});

describe("parseConsentLevel", () => {
  it.each(["BOOKINGS", "HISTORY"])("aceita %s", (level) => {
    expect(parseConsentLevel(level)).toBe(level);
  });
  it.each([undefined, "ALL", "", 1])("rejeita %j", (level) => {
    expect(() => parseConsentLevel(level)).toThrow(ValidationError);
  });
});
