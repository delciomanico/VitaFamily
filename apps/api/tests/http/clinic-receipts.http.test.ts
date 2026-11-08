// HTTP (supertest + express-openapi-validator contra docs/05-api/openapi.yaml, SEM base de dados): recibos, perfil, equipa e
// auditoria da clínica por papel (M14 R, AC-CLN-25..29, TC-CLN-17..20, TC-AZ-CLN-V5). Casos de uso reais sobre fakes.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../src/platform/clock/index.js";
import { createApp } from "../../src/platform/http/index.js";
import { createLogger } from "../../src/platform/logger/index.js";
import { InMemoryRateLimiter } from "../../src/platform/rate-limit/index.js";
import { createListClinicAuditUseCase } from "../../src/modules/audit/application/list-clinic-audit.js";
import { createClinicAuditRouter } from "../../src/modules/audit/interface/clinic-audit-router.js";
import { createClinicReceiptsFixtures } from "../../src/modules/clinic-receipts/application/fixtures.js";
import { createIssueReceiptUseCase } from "../../src/modules/clinic-receipts/application/issue-receipt.js";
import { createGetReceiptUseCase, createListReceiptsUseCase } from "../../src/modules/clinic-receipts/application/list-receipts.js";
import { createVoidReceiptUseCase } from "../../src/modules/clinic-receipts/application/void-receipt.js";
import { createClinicReceiptsPortalRouter } from "../../src/modules/clinic-receipts/interface/portal-router.js";
import { createGetClinicProfileUseCase, createUpdateClinicProfileUseCase } from "../../src/modules/clinics/application/clinic-profile.js";
import { createClinicsFixtures } from "../../src/modules/clinics/application/fixtures.js";
import { createCreateClinicStaffUseCase, createListClinicStaffUseCase } from "../../src/modules/clinics/application/manage-clinic-staff.js";
import { signClinicAccessToken } from "../../src/modules/clinics/domain/clinic-jwt.js";
import { createClinicActorContextMiddleware, createClinicBearerAuthSecurityHandler } from "../../src/modules/clinics/interface/clinic-portal-middleware.js";
import { createClinicPortalRouter, type ClinicPortalController } from "../../src/modules/clinics/interface/clinic-portal-router.js";

const OPENAPI_SPEC_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../../../docs/05-api/openapi.yaml");
const NOW = new Date("2026-11-08T10:00:00.000Z");
const CLINIC = "33333333-3333-4333-8333-333333333333";
const ADMIN = "55555555-5555-4555-8555-555555555555";
const MANAGER = "66666666-6666-4666-8666-666666666666";
const DOCTOR = "77777777-7777-4777-8777-777777777771";
const PROFESSIONAL = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
const SESSION = "88888888-8888-4888-8888-888888888888";
const BOOKING = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const KEYS = [{ kid: "k1", secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef") }];
const API = "/api/v1/clinic-portal";
const ROLE_OF: Record<string, "CLINIC_ADMIN" | "CLINIC_MANAGER" | "CLINIC_DOCTOR"> = { [ADMIN]: "CLINIC_ADMIN", [MANAGER]: "CLINIC_MANAGER", [DOCTOR]: "CLINIC_DOCTOR" };

async function buildHarness() {
  const clock = new FixedClock(NOW);
  const rx = createClinicReceiptsFixtures(clock);
  rx.services.services.set("svc-1", { id: "svc-1", clinicId: CLINIC, name: "Consulta", priceMinor: 250_000 });
  rx.bookings.seed("APPOINTMENT", BOOKING, CLINIC, { status: "COMPLETED", patientName: "Maria Silva", serviceTypeId: "svc-1" });
  const cl = createClinicsFixtures(clock);
  await cl.clinicsRepo.insert(undefined as never, { id: CLINIC, type: "PARTNER", name: "Clínica Sol", createdAt: NOW });
  await cl.catalogRepo.insertProfessional(undefined as never, { id: PROFESSIONAL, clinicId: CLINIC, name: "Dra. Lima", specialty: null, createdAt: NOW });
  const auditCalls: unknown[] = [];

  const controller = {
    getClinicProfile: createGetClinicProfileUseCase(cl.deps),
    updateClinicProfile: createUpdateClinicProfileUseCase(cl.deps),
    listClinicStaff: createListClinicStaffUseCase(cl.deps),
    createClinicStaff: createCreateClinicStaffUseCase(cl.deps),
  } as unknown as ClinicPortalController;
  const receiptsController = {
    listClinicReceipts: createListReceiptsUseCase(rx.deps),
    createClinicReceipt: createIssueReceiptUseCase(rx.deps),
    getClinicReceipt: createGetReceiptUseCase(rx.deps),
    voidClinicReceipt: createVoidReceiptUseCase(rx.deps),
  };
  const auditController = {
    listClinicAudit: createListClinicAuditUseCase({
      reader: { list: (_t, filter) => { auditCalls.push(filter); return Promise.resolve([]); } },
      withTransaction: (fn) => fn(undefined),
      limiter: new InMemoryRateLimiter(clock),
      clock,
    }),
  };

  const app = createApp({
    openApiSpecPath: OPENAPI_SPEC_PATH,
    logger: createLogger({ level: "silent" }),
    securityHandlers: { bearerAuth: () => Promise.resolve(false), clinicBearerAuth: createClinicBearerAuthSecurityHandler({ signingKeys: KEYS, clock }) },
    actorContextMiddleware: createClinicActorContextMiddleware({
      resolveClinicActorState: (clinicAccountId, sessionId) =>
        Promise.resolve({ clinicAccountId, sessionId, clinicId: CLINIC, role: ROLE_OF[clinicAccountId] ?? "CLINIC_MANAGER", ...(clinicAccountId === DOCTOR ? { professionalId: PROFESSIONAL } : {}), suspended: false }),
    }),
    registerHealthRoutes: (router) => {
      router.get("/health", (_req, res) => res.json({ status: "ok" }));
    },
    registerRoutes: (router) => {
      router.use(createClinicPortalRouter(controller, "localhost"));
      router.use(createClinicReceiptsPortalRouter(receiptsController));
      router.use(createClinicAuditRouter(auditController));
    },
  });
  const token = async (account: string) => (await signClinicAccessToken({ subject: { clinicAccountId: account, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token;
  return { app, rx, cl, auditCalls, admin: await token(ADMIN), manager: await token(MANAGER), doctor: await token(DOCTOR) };
}
type H = Awaited<ReturnType<typeof buildHarness>>;
const call = (h: H, method: "get" | "post" | "patch", path: string, token: string, body?: Record<string, unknown>) => {
  const req = request(h.app)[method](`${API}${path}`).set("Authorization", `Bearer ${token}`);
  return body ? req.send(body) : req;
};

describe("recibos (UC-CLN-25..27, BR-CLN-31..37)", () => {
  let h: H;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("emitir (201, forma do contrato) -> ver -> listar (summary) -> anular (200) -> reemitir; sem token 401", async () => {
    expect((await request(h.app).get(`${API}/receipts?from=2026-11-08&to=2026-11-08`)).status).toBe(401);
    const created = await call(h, "post", "/receipts", h.manager, { bookingKind: "APPOINTMENT", bookingId: BOOKING, paymentMethod: "CARD" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ number: 1, status: "ISSUED", totalMinor: 250_000, currency: "AOA", notice: "Documento não fiscal — não substitui fatura", availableToPatient: false, lines: [{ position: 1, description: "Consulta", amountMinor: 250_000, serviceTypeId: "svc-1" }] });
    const id = (created.body as { id: string }).id;
    expect((await call(h, "get", `/receipts/${id}`, h.admin)).status).toBe(200);
    expect((await call(h, "post", "/receipts", h.admin, { bookingKind: "APPOINTMENT", bookingId: BOOKING, paymentMethod: "CASH" })).status).toBe(409);
    const list = await call(h, "get", "/receipts?from=2026-11-08&to=2026-11-08", h.admin);
    expect(list.body).toMatchObject({ summary: { issuedCount: 1, issuedTotalMinor: 250_000, voidedCount: 0, currency: "AOA" }, nextCursor: null });
    const voided = await call(h, "post", `/receipts/${id}/void`, h.admin, { reason: "Valor errado" });
    expect(voided.status).toBe(200);
    expect(voided.body).toMatchObject({ status: "VOIDED", number: 1 });
    expect((await call(h, "post", `/receipts/${id}/void`, h.admin, { reason: "Outra vez" })).status).toBe(409);
    expect((await call(h, "get", "/receipts?from=2026-11-08&to=2026-11-08", h.admin)).body).toMatchObject({ summary: { issuedCount: 0, issuedTotalMinor: 0, voidedCount: 1 } });
    expect(((await call(h, "post", "/receipts", h.admin, { bookingKind: "APPOINTMENT", bookingId: BOOKING, paymentMethod: "CASH" })).body as { number: number }).number).toBe(2);
  });

  it("validação do contrato: método inválido, corpo com campos extra, motivo curto, janela sem to => 4xx", async () => {
    for (const body of [{ bookingKind: "APPOINTMENT", bookingId: BOOKING, paymentMethod: "BITCOIN" }, { bookingKind: "APPOINTMENT", bookingId: BOOKING, paymentMethod: "CASH", totalMinor: 1 }, { bookingKind: "APPOINTMENT", bookingId: "x", paymentMethod: "CASH" }]) {
      expect((await call(h, "post", "/receipts", h.admin, body)).status).toBe(422);
    }
    expect((await call(h, "get", "/receipts?from=2026-11-08", h.admin)).status).toBeGreaterThanOrEqual(400);
    expect((await call(h, "get", "/receipts?from=2025-01-01&to=2026-11-08", h.admin)).status).toBe(422);
  });

  it("Médico => 403 em todas as rotas de recibos (matriz §6.2b), antes de qualquer lógica", async () => {
    const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    expect((await call(h, "get", "/receipts?from=2026-11-08&to=2026-11-08", h.doctor)).status).toBe(403);
    expect((await call(h, "post", "/receipts", h.doctor, { bookingKind: "APPOINTMENT", bookingId: BOOKING, paymentMethod: "CASH" })).status).toBe(403);
    expect((await call(h, "get", `/receipts/${id}`, h.doctor)).status).toBe(403);
    expect((await call(h, "post", `/receipts/${id}/void`, h.doctor, { reason: "abc" })).status).toBe(403);
    expect(h.rx.receiptsRepo.byId.size).toBe(0);
  });
});

describe("perfil, equipa e auditoria por papel (BR-CLN-38..40, matriz §6.2b)", () => {
  let h: H;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("perfil: Admin lê e edita; Gestor lê mas não escreve (403); Médico 403 nos dois", async () => {
    expect((await call(h, "patch", "/profile", h.admin, { displayName: "Sol Saúde", openingHours: "Seg-Sex 9-18" })).body).toMatchObject({ name: "Clínica Sol", displayName: "Sol Saúde", currency: "AOA" });
    expect((await call(h, "get", "/profile", h.manager)).status).toBe(200);
    expect((await call(h, "patch", "/profile", h.manager, { phone: "1" })).status).toBe(403);
    expect((await call(h, "get", "/profile", h.doctor)).status).toBe(403);
    expect((await call(h, "patch", "/profile", h.doctor, { phone: "1" })).status).toBe(403);
    expect((await call(h, "patch", "/profile", h.admin, { name: "Outro" })).status).toBe(422);
    expect((await call(h, "patch", "/profile", h.admin, {})).status).toBe(422);
  });

  it("equipa: só o Admin cria Gestor ou Médico (com profissional) e lista; Gestor e Médico 403", async () => {
    const doctor = await call(h, "post", "/staff", h.admin, { email: "medico@c.pt", role: "CLINIC_DOCTOR", professionalId: PROFESSIONAL });
    expect(doctor.status).toBe(201);
    expect(doctor.body).toMatchObject({ role: "CLINIC_DOCTOR", professionalId: PROFESSIONAL });
    expect((await call(h, "post", "/staff", h.admin, { email: "medico2@c.pt", role: "CLINIC_DOCTOR", professionalId: PROFESSIONAL })).status).toBe(409);
    expect((await call(h, "post", "/staff", h.admin, { email: "g@c.pt" })).status).toBe(201);
    expect((await call(h, "get", "/staff", h.admin)).status).toBe(200);
    for (const token of [h.manager, h.doctor]) {
      expect((await call(h, "get", "/staff", token)).status).toBe(403);
      expect((await call(h, "post", "/staff", token, { email: "x@c.pt" })).status).toBe(403);
    }
  });

  it("auditoria: só o Admin (200, filtrada pela clínica do token); Gestor e Médico 403", async () => {
    expect((await call(h, "get", "/audit", h.admin)).body).toEqual({ items: [], nextCursor: null });
    expect(h.auditCalls[0]).toMatchObject({ clinicId: CLINIC });
    expect((await call(h, "get", "/audit", h.manager)).status).toBe(403);
    expect((await call(h, "get", "/audit", h.doctor)).status).toBe(403);
    expect((await call(h, "get", "/audit?limit=500", h.admin)).status).toBeGreaterThanOrEqual(400);
  });
});
