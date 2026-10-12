import { describe, expect, it } from "vitest";
import { effectiveStatus, exportExpiry, type DataExport } from "./export.js";

const base: DataExport = { id: "e", requestedBy: "u", reason: "USER_REQUEST", status: "READY", createdAt: new Date("2026-10-01T00:00:00Z") };

describe("estado efetivo da exportação", () => {
  it("validade de 7 dias", () => {
    expect(exportExpiry(new Date("2026-10-01T00:00:00Z")).toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });

  it.each([
    ["READY dentro da validade", { ...base, expiresAt: new Date("2026-10-08T00:00:00Z") }, "2026-10-05T00:00:00Z", "READY"],
    ["READY passada a validade", { ...base, expiresAt: new Date("2026-10-08T00:00:00Z") }, "2026-10-08T00:00:00Z", "EXPIRED"],
    ["PENDING recente", { ...base, status: "PENDING" as const }, "2026-10-01T00:05:00Z", "PENDING"],
    ["PENDING esquecido", { ...base, status: "PENDING" as const }, "2026-10-01T00:20:00Z", "FAILED"],
    ["FAILED mantém-se", { ...base, status: "FAILED" as const }, "2026-12-01T00:00:00Z", "FAILED"],
  ])("%s", (_name, item, now, expected) => {
    expect(effectiveStatus(item, new Date(now))).toBe(expected);
  });
});
