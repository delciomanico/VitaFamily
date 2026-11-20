// ADR-038 §5 (RL5, RL6, RL7): com o suporte dos limitadores em falha, estas rotas falham fechadas (503, nunca passam);
// quando o limitador recusa, o 429 mantém-se. O limitador é a primeira operação de cada caso de uso.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../src/platform/clock/index.js";
import { RateLimiterUnavailableError, type RateLimiter } from "../src/platform/rate-limit/async.js";
import { FailingRateLimiter } from "../src/platform/rate-limit/failing.js";
import { createListClinicAuditUseCase } from "../src/modules/audit/application/list-clinic-audit.js";
import { createListReceiptsUseCase } from "../src/modules/clinic-receipts/application/list-receipts.js";
import { createUploadClinicExamDocumentUseCase } from "../src/modules/documents/application/clinic-documents.js";
import { createUploadDocumentUseCase } from "../src/modules/documents/application/upload-document.js";
import { createSaveResultsDraftUseCase } from "../src/modules/examinations/application/results-draft.js";
import { createClinicPatientLookupUseCase } from "../src/modules/appointments/application/clinic-walk-in.js";
import { createListClinicPatientsUseCase } from "../src/modules/clinic-patients/application/patients.js";
import { enforceRate } from "../src/modules/consultations/application/rate-limit.js";
import { createLookupInvitationUseCase } from "../src/modules/families/application/lookup-invitation.js";

const CONTEXT = { requestId: "req-1", ip: "203.0.113.1" } as never;
const CLINIC_ACTOR = { clinicAccountId: "ca1", clinicId: "c1", role: "CLINIC_ADMIN" } as never;
const FILE = { buffer: Buffer.alloc(1), originalName: "a.pdf" };

const cases: [string, (limiter: RateLimiter) => Promise<unknown>][] = [
  ["families: consulta de convite", (l) => createLookupInvitationUseCase({ invitationRateLimiter: l } as never)("tok", CONTEXT)],
  [
    "documents: upload do utilizador",
    (l) => createUploadDocumentUseCase({ rateLimiter: l } as never)({ userId: "u1" } as never, "f1", "m1", { resourceId: "r1", file: FILE } as never, CONTEXT),
  ],
  [
    "documents: upload da clínica",
    (l) => createUploadClinicExamDocumentUseCase({ rateLimiter: l } as never)({ clinicAccountId: "ca1" }, { examinationId: "e1", file: FILE }, () => Promise.reject(new Error("não chega")), CONTEXT),
  ],
  ["audit: auditoria da clínica", (l) => createListClinicAuditUseCase({ limiter: l } as never)(CLINIC_ACTOR, {})],
  ["clinic-receipts: listagem", (l) => createListReceiptsUseCase({ listLimiter: l } as never)(CLINIC_ACTOR, {})],
  ["examinations: rascunho de resultados", (l) => createSaveResultsDraftUseCase({ limiter: l } as never)(CLINIC_ACTOR, "e1", {}, CONTEXT)],
  // `withTransaction`/`audit`/`clock` só são usados no ramo 429 (auditoria DENIED antes do RateLimitedError).
  [
    "appointments: walk-in (pesquisa de paciente)",
    (l) =>
      createClinicPatientLookupUseCase({
        walkInRateLimiter: l,
        withTransaction: (fn: (trx: unknown) => Promise<unknown>) => fn({}),
        audit: { record: () => Promise.resolve() },
        clock: { now: () => new Date("2026-10-12T10:00:00Z") },
      } as never)(CLINIC_ACTOR, { email: "a@b.pt" }, CONTEXT),
  ],
  ["clinic-patients: pesquisa", (l) => createListClinicPatientsUseCase({ searchLimiter: l } as never)(CLINIC_ACTOR, {})],
  ["consultations: comprovativo (upload)", (l) => enforceRate(l, "proof-upload", "u1")],
];

const denying: RateLimiter = {
  consume: () => Promise.resolve({ allowed: false, retryAfterMs: 1_000 }),
  peek: () => Promise.resolve({ allowed: false, retryAfterMs: 1_000 }),
  reset: () => Promise.resolve(),
};

describe("RL5..RL7: limitador em falha e 429", () => {
  const failing = new FailingRateLimiter(new FixedClock(new Date("2026-10-12T10:00:00Z")), "teste");

  it.each(cases)("%s: 503 com o limitador em falha", async (_name, call) => {
    await expect(call(failing)).rejects.toBeInstanceOf(RateLimiterUnavailableError);
  });

  it.each(cases)("%s: 429 (RATE_LIMITED) quando o limitador recusa", async (_name, call) => {
    await expect(call(denying)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
