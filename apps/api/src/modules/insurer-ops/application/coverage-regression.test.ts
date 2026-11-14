// TC-COV-12 (BR-SEG-18/29/31): regressão da elegibilidade da clínica e do cartão do paciente. O snapshot foi gravado ANTES de
// migrar `eligibility.ts`/`clinic-portal.ts`/`patient-insurance.ts` para `evaluateCoverage` e tem de ficar idêntico depois.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { InMemoryRateLimiter } from "../domain/rate-limiter.js";
import { createCheckEligibilityUseCase } from "./clinic-portal.js";
import { createGetCardCoverageUseCase } from "./patient-insurance.js";
import type { EligibilityCandidate, OpsDeps } from "./ports.js";

const INSURER = "11111111-1111-4111-8111-111111111111";
const CLINIC_ACTOR = { clinicAccountId: "ca", clinicId: "c1", role: "CLINIC_ADMIN" } as never;
const CTX = { requestId: "r1" };
const FAMILY_ACTOR = { userId: "u1", platformAdmin: false };

const policy = (over: Partial<NonNullable<EligibilityCandidate["policy"]>> = {}) => ({ planId: "p1", planName: "Plano Ouro", number: "AP-1", status: "ACTIVE", validFrom: "2026-01-01", validTo: "2026-12-31", ...over });
const ROWS = [
  { serviceId: "s1", serviceCode: "CONS", serviceName: "Consulta", copayPct: 80, limitPerYear: 1234.56, waitingDays: 30, requiresAuthorization: true },
  { serviceId: "s2", serviceCode: "LAB", serviceName: "Análises", copayPct: 100, limitPerYear: null, waitingDays: 0, requiresAuthorization: false },
  { serviceId: "s3", serviceCode: "RX", serviceName: "Raio-X", copayPct: 50.5, limitPerYear: 0, waitingDays: 29, requiresAuthorization: false },
];

/** Como `KyselyEligibilityRepository.find`: só devolve a apólice `ACTIVE` e vigente em `today`. */
function asRepoReturns(c: EligibilityCandidate | null, today: string): EligibilityCandidate | null {
  const p = c?.policy;
  if (!c || !p) return c;
  return p.status === "ACTIVE" && p.validFrom <= today && today <= p.validTo ? c : { ...c, policy: null };
}

function depsFor(candidate: EligibilityCandidate | null, clock: Date) {
  const found = asRepoReturns(candidate, clock.toISOString().slice(0, 10));
  return {
    withTransaction: <T>(fn: (trx: null) => Promise<T>) => fn(null),
    providers: { isActivelyLinked: () => Promise.resolve(true) },
    insurers: { get: () => Promise.resolve({ name: "Seg", operationalModuleEnabled: true, currency: "AOA", status: "ACTIVE" }) },
    eligibility: {
      find: () => Promise.resolve(found),
      coverages: () => Promise.resolve(ROWS),
      serviceCodeExists: () => Promise.resolve(true),
    },
    patients: { findLinked: () => Promise.resolve({ insurerId: INSURER, beneficiaryId: "b1" }) },
    patientAccess: { authorize: () => Promise.resolve({ relation: "SELF" }) },
    rateLimiter: new InMemoryRateLimiter(new FixedClock(clock)),
    audit: { record: () => Promise.resolve() },
    clock: new FixedClock(clock),
    claimCodeSecret: "segredo-de-teste-com-32-caracteres!!",
  } as unknown as OpsDeps<null>;
}

const candidate = (status: string, pol: EligibilityCandidate["policy"]): EligibilityCandidate => ({ beneficiaryId: "b1", name: "Ana", cardNumber: "C1", status, cardVersion: 1, policy: pol });
const CASES: [string, EligibilityCandidate | null][] = [
  ["elegível", candidate("ACTIVE", policy())],
  ["beneficiário suspenso", candidate("SUSPENDED", policy())],
  ["sem apólice", candidate("ACTIVE", null)],
  ["apólice suspensa", candidate("ACTIVE", policy({ status: "SUSPENDED" }))],
  ["apólice ainda não iniciada", candidate("ACTIVE", policy({ validFrom: "2026-02-01" }))],
  ["apólice caducada", candidate("ACTIVE", policy({ validTo: "2026-01-29" }))],
  ["último dia da apólice", candidate("ACTIVE", policy({ validTo: "2026-01-30" }))],
  ["inexistente", null],
];
const DAYS = ["2026-01-29T10:00:00.000Z", "2026-01-30T10:00:00.000Z", "2026-01-31T10:00:00.000Z"];

describe("TC-COV-12: elegibilidade da clínica (JSON idêntico)", () => {
  for (const day of DAYS) {
    it.each(CASES)(`${day.slice(0, 10)} · %s`, async (_name, cand) => {
      const result = await createCheckEligibilityUseCase(depsFor(cand, new Date(day)))(CLINIC_ACTOR, INSURER, { cardNumber: "C1" }, CTX);
      expect(JSON.parse(JSON.stringify(result))).toMatchSnapshot();
    });
  }
});

describe("TC-COV-12: cobertura do cartão do paciente (JSON idêntico)", () => {
  for (const day of DAYS) {
    it.each(CASES.filter(([, c]) => c !== null))(`${day.slice(0, 10)} · %s`, async (_name, cand) => {
      const view = await createGetCardCoverageUseCase(depsFor(cand, new Date(day)))(FAMILY_ACTOR, "f1", "m1", "b1", CTX);
      expect(JSON.parse(JSON.stringify(view))).toMatchSnapshot();
    });
  }
});
