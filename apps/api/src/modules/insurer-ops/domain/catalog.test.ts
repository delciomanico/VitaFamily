// Regras puras de S2/S3: serviços, planos/versões/coberturas (TC-SEG-02/03), papéis (TC-AZ-SEG-01/04), QR e rate limit.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { assertClinicRole, assertOpsRole, type ClinicOpsRole, type OpsRole } from "./access.js";
import { CARD_QR_TTL_SECONDS, signCardQrToken, verifyCardQrToken } from "./card-qr.js";
import { addDays, isEligible, parseEligibilityRequest, toCoverageLimits } from "./eligibility.js";
import { assertCanCreateVersion, assertCoveragesEditable, assertPlanTransition, coverageTypeOf, parseCoverageItems } from "./plan.js";
import { InMemoryRateLimiter } from "./rate-limiter.js";
import { parseServiceInput, parseServicePatch } from "./service.js";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

describe("papéis: acesso `admin` (planos, serviços, prestadores, clínicas parceiras)", () => {
  const roles: [OpsRole, boolean][] = [
    ["INSURANCE_ADMIN", true],
    ["BENEFICIARY_MANAGER", false],
    ["AUTHORIZATION_ANALYST", false],
    ["CLAIMS_MANAGER", false],
    ["FINANCE_MANAGER", false],
    ["INSURANCE_AGENT", false],
  ];
  it.each(roles)("%s admin ⇒ %s", (role, allowed) => {
    expect(codeOf(() => { assertOpsRole(role, "admin"); })).toBe(allowed ? undefined : "FORBIDDEN");
  });
});

describe("clínica: papéis (§8.4, Q6; Médico ⇒ FORBIDDEN)", () => {
  it.each<[ClinicOpsRole, string | undefined]>([["CLINIC_ADMIN", undefined], ["CLINIC_MANAGER", undefined], ["CLINIC_DOCTOR", "FORBIDDEN"]])("%s", (role, code) => {
    expect(codeOf(() => { assertClinicRole(role); })).toBe(code);
  });
});

describe("serviços (BR-SEG-22)", () => {
  it("cria com código, nome e categoria opcional; rejeita vazio e excesso", () => {
    expect(parseServiceInput({ code: " C1 ", name: " Consulta ", category: " " })).toEqual({ code: "C1", name: "Consulta", category: null });
    expect(codeOf(() => parseServiceInput({ code: "", name: "x" }))).toBe("VALIDATION_ERROR");
    expect(codeOf(() => parseServiceInput({ code: "x".repeat(41), name: "x" }))).toBe("VALIDATION_ERROR");
  });
  it("PATCH: nome, categoria e estado; estado inválido ⇒ erro", () => {
    expect(parseServicePatch({ status: "INACTIVE", category: null })).toEqual({ status: "INACTIVE", category: null });
    expect(codeOf(() => parseServicePatch({ status: "X" }))).toBe("VALIDATION_ERROR");
  });
});

describe("planos (UC-SEG-04, ST Plan)", () => {
  it.each<[string, number, unknown, string | undefined]>([
    ["DRAFT", 1, "ACTIVE", undefined],
    ["DRAFT", 0, "ACTIVE", "CONFLICT"],
    ["ACTIVE", 1, "ARCHIVED", undefined],
    ["DRAFT", 1, "ARCHIVED", "INVALID_STATE_TRANSITION"],
    ["ACTIVE", 1, "ACTIVE", "INVALID_STATE_TRANSITION"],
    ["ARCHIVED", 1, "ACTIVE", "INVALID_STATE_TRANSITION"],
    ["DRAFT", 1, "DRAFT", "VALIDATION_ERROR"],
  ])("%s (%s coberturas) → %s ⇒ %s", (status, coverageCount, to, code) => {
    expect(codeOf(() => assertPlanTransition({ status: status as "DRAFT", coverageCount }, to))).toBe(code);
  });
  it("nova versão só de ACTIVE; coberturas só em DRAFT", () => {
    expect(codeOf(() => { assertCanCreateVersion({ status: "ACTIVE" }); })).toBeUndefined();
    expect(codeOf(() => { assertCanCreateVersion({ status: "DRAFT" }); })).toBe("CONFLICT");
    expect(codeOf(() => { assertCoveragesEditable({ status: "DRAFT" }); })).toBeUndefined();
    expect(codeOf(() => { assertCoveragesEditable({ status: "ACTIVE" }); })).toBe("CONFLICT");
    expect(codeOf(() => { assertCoveragesEditable({ status: "ARCHIVED" }); })).toBe("CONFLICT");
  });
});

describe("coberturas (TC-SEG-03)", () => {
  it.each<[boolean, number | null, string]>([[false, null, "EXCLUDED"], [false, 100, "EXCLUDED"], [true, null, "INCLUDED"], [true, 5000, "LIMITED"]])("covered=%s limit=%s ⇒ %s", (covered, limit, type) => {
    expect(coverageTypeOf(covered, limit)).toBe(type);
  });
  it("valores por omissão e não coberto ignora o teto", () => {
    const [a, b] = parseCoverageItems({ items: [{ serviceId: U1, covered: true }, { serviceId: U2, covered: false, limitPerYear: 10, copayPct: 50 }] });
    expect(a).toEqual({ serviceId: U1, type: "INCLUDED", copayPct: 100, limitPerYear: null, waitingDays: 0, requiresAuthorization: false });
    expect(b).toMatchObject({ type: "EXCLUDED", limitPerYear: null, copayPct: 50 });
  });
  it.each<[string, unknown]>([
    ["não é lista", { items: "x" }],
    ["serviceId repetido", { items: [{ serviceId: U1, covered: true }, { serviceId: U1, covered: false }] }],
    ["serviceId não UUID", { items: [{ serviceId: "x", covered: true }] }],
    ["covered em falta", { items: [{ serviceId: U1 }] }],
    ["copayPct > 100", { items: [{ serviceId: U1, covered: true, copayPct: 100.5 }] }],
    ["copayPct < 0", { items: [{ serviceId: U1, covered: true, copayPct: -1 }] }],
    ["limite negativo", { items: [{ serviceId: U1, covered: true, limitPerYear: -1 }] }],
    ["3 casas decimais", { items: [{ serviceId: U1, covered: true, limitPerYear: 1.005 }] }],
    ["carência não inteira", { items: [{ serviceId: U1, covered: true, waitingDays: 1.5 }] }],
    ["carência negativa", { items: [{ serviceId: U1, covered: true, waitingDays: -1 }] }],
    ["mais de 1000", { items: Array.from({ length: 1001 }, () => ({ serviceId: U1, covered: true })) }],
  ])("%s ⇒ VALIDATION_ERROR", (_name, input) => {
    expect(codeOf(() => parseCoverageItems(input as { items?: unknown }))).toBe("VALIDATION_ERROR");
  });
});

describe("elegibilidade (BR-SEG-01/04/18)", () => {
  const policy = { status: "ACTIVE", validFrom: "2026-01-01", validTo: "2026-12-31" };
  it.each<[string, typeof policy | null, string, boolean]>([
    ["ACTIVE", policy, "2026-11-11", true],
    ["ACTIVE", policy, "2026-01-01", true],
    ["ACTIVE", policy, "2026-12-31", true],
    ["ACTIVE", policy, "2025-12-31", false],
    ["ACTIVE", policy, "2027-01-01", false],
    ["ACTIVE", { ...policy, status: "SUSPENDED" }, "2026-11-11", false],
    ["ACTIVE", { ...policy, status: "EXPIRED" }, "2026-11-11", false],
    ["PENDING", policy, "2026-11-11", false],
    ["SUSPENDED", policy, "2026-11-11", false],
    ["CANCELLED", policy, "2026-11-11", false],
    ["ACTIVE", null, "2026-11-11", false],
  ])("beneficiário %s, apólice %j, hoje %s ⇒ %s", (status, p, today, expected) => {
    expect(isEligible(status, p, today)).toBe(expected);
  });

  it("carência conta a partir de validFrom (BR-SEG-04)", () => {
    const row = { serviceCode: "C", serviceName: "Consulta", copayPct: 80, limitPerYear: 1000, waitingDays: 30, requiresAuthorization: true };
    expect(addDays("2026-01-01", 30)).toBe("2026-01-31");
    expect(toCoverageLimits(row, "2026-01-01", "2026-01-30")).toMatchObject({ coveredNow: false, waitingEndsOn: "2026-01-31" });
    expect(toCoverageLimits(row, "2026-01-01", "2026-01-31")).toMatchObject({ coveredNow: true, waitingEndsOn: "2026-01-31" });
    expect(toCoverageLimits({ ...row, waitingDays: 0 }, "2026-01-01", "2026-01-01")).toMatchObject({ coveredNow: true, waitingEndsOn: null });
  });

  it("exatamente um identificador (senão VALIDATION_ERROR)", () => {
    expect(parseEligibilityRequest({ cardNumber: " vf1 " })).toEqual({ by: { kind: "CARD", cardNumber: "VF1" }, serviceCode: null });
    expect(parseEligibilityRequest({ idDocument: { type: "bi", number: "N1" }, serviceCode: "C1" })).toEqual({ by: { kind: "DOCUMENT", type: "BI", number: "N1" }, serviceCode: "C1" });
    expect(codeOf(() => parseEligibilityRequest({}))).toBe("VALIDATION_ERROR");
    expect(codeOf(() => parseEligibilityRequest({ cardNumber: "a", qrToken: "b" }))).toBe("VALIDATION_ERROR");
    expect(codeOf(() => parseEligibilityRequest({ cardNumber: "a", idDocument: { type: "BI", number: "1" } }))).toBe("VALIDATION_ERROR");
    expect(codeOf(() => parseEligibilityRequest({ idDocument: { type: "BI" } }))).toBe("VALIDATION_ERROR");
  });
});

describe("token do QR (BR-SEG-18)", () => {
  const now = new Date("2026-11-11T10:00:00.000Z");
  const claims = { insurerId: U1, beneficiaryId: U2, cardVersion: 3, expiresAt: Math.floor(now.getTime() / 1000) + CARD_QR_TTL_SECONDS };
  it("assina e verifica; expira; segredo/assinatura/estrutura adulterados ⇒ null", () => {
    const token = signCardQrToken("segredo", claims);
    expect(verifyCardQrToken("segredo", token, now)).toEqual(claims);
    expect(verifyCardQrToken("segredo", token, new Date(now.getTime() + (CARD_QR_TTL_SECONDS + 1) * 1000))).toBeNull();
    expect(verifyCardQrToken("outro", token, now)).toBeNull();
    const [payload, sig] = token.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ v: 1, i: U1, b: U2, c: 4, e: claims.expiresAt }), "utf8").toString("base64url");
    expect(verifyCardQrToken("segredo", `${forged}.${sig}`, now)).toBeNull();
    expect(verifyCardQrToken("segredo", `${payload}x.${sig}`, now)).toBeNull();
    for (const junk of ["", "x", "a.b.c", "a.b", `${payload}.`]) expect(verifyCardQrToken("segredo", junk, now)).toBeNull();
  });
  it("o segredo dos códigos de reclamação não valida QR de outro domínio (prefixo distinto)", () => {
    expect(signCardQrToken("s", claims)).not.toBe(signCardQrToken("s2", claims));
  });
});

describe("rate limiter em memória", () => {
  it("bloqueia ao atingir o máximo, informa Retry-After e liberta ao fim da janela", () => {
    const clock = new FixedClock(new Date("2026-11-11T10:00:00.000Z"));
    const limiter = new InMemoryRateLimiter(clock);
    const rule = { max: 2, windowMs: 60_000 };
    expect(limiter.peek("k", rule).allowed).toBe(true);
    limiter.record("k", rule);
    limiter.record("k", rule);
    const blocked = limiter.peek("k", rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(60_000);
    expect(limiter.peek("outra", rule).allowed).toBe(true);
    clock.set(new Date("2026-11-11T10:01:00.001Z"));
    expect(limiter.peek("k", rule).allowed).toBe(true);
  });

  it("varre as chaves expiradas (sem fuga de memória) e mantém as ativas", () => {
    const clock = new FixedClock(new Date("2026-11-11T10:00:00.000Z"));
    const limiter = new InMemoryRateLimiter(clock);
    const rule = { max: 1, windowMs: 60_000 };
    for (let i = 0; i < 5001; i++) limiter.record(`old:${String(i)}`, rule);
    clock.set(new Date("2026-11-11T10:02:00.000Z"));
    limiter.record("novo", rule); // dispara a varredura (> 5000 chaves)
    const tracked = (limiter as unknown as { hits: Map<string, number[]> }).hits;
    expect([...tracked.keys()]).toEqual(["novo"]);
    expect(limiter.peek("novo", rule).allowed).toBe(false);
  });
});
