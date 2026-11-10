// HTTP (supertest + express-openapi-validator contra docs/05-api/openapi.yaml, SEM base de dados): catálogo,
// regras de horário, bloqueios e `/slots` com profissional (M14 a1/a2, TC-CLN-04/05/06, AC-CLN-07..11).
// Os casos de uso reais correm sobre os fakes das fixtures. Cobre: ambos os papéis, tokens de User e de
// seguradora rejeitados, isolamento entre clínicas (404/lista vazia), validação do contrato e canários sem PII.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../src/platform/clock/index.js";
import { createApp } from "../../src/platform/http/index.js";
import { createLogger } from "../../src/platform/logger/index.js";
import { signAccessToken } from "../../src/modules/auth/domain/jwt.js";
import { createBearerAuthSecurityHandler } from "../../src/modules/auth/interface/middleware.js";
import { createCreateClinicProfessionalUseCase, createCreateClinicServiceTypeUseCase, createListClinicExamServiceTypesUseCase, createListClinicProfessionalsUseCase, createListClinicServiceTypesUseCase, createUpdateClinicProfessionalUseCase, createUpdateClinicServiceTypeUseCase } from "../../src/modules/clinics/application/clinic-catalog.js";
import { createCreateClinicScheduleRuleUseCase, createListClinicScheduleRulesUseCase, createRegenerateClinicScheduleRuleUseCase, createUpdateClinicScheduleRuleUseCase } from "../../src/modules/clinics/application/clinic-schedule-rules.js";
import { createListOwnClinicSlotsUseCase, createPublishClinicSlotsUseCase, createRemoveClinicSlotUseCase, createUpdateClinicSlotUseCase } from "../../src/modules/clinics/application/clinic-slots.js";
import { createCreateClinicTimeOffUseCase, createDeleteClinicTimeOffUseCase, createListClinicTimeOffUseCase } from "../../src/modules/clinics/application/clinic-time-off.js";
import { createClinicsFixtures } from "../../src/modules/clinics/application/fixtures.js";
import { signClinicAccessToken } from "../../src/modules/clinics/domain/clinic-jwt.js";
import { createClinicActorContextMiddleware, createClinicBearerAuthSecurityHandler } from "../../src/modules/clinics/interface/clinic-portal-middleware.js";
import { createClinicPortalRouter, type ClinicPortalController } from "../../src/modules/clinics/interface/clinic-portal-router.js";
import { signInsuranceAccessToken } from "../../src/modules/insurance/domain/insurance-jwt.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OPENAPI_SPEC_PATH = join(REPO_ROOT, "docs/05-api/openapi.yaml");
const NOW = new Date("2026-10-11T08:00:00.000Z"); // domingo, WEST
const CLINIC_A = "33333333-3333-4333-8333-333333333333";
const CLINIC_B = "44444444-4444-4444-8444-444444444444";
const ACCOUNT_ADMIN = "55555555-5555-4555-8555-555555555555";
const ACCOUNT_MANAGER = "66666666-6666-4666-8666-666666666666";
const ACCOUNT_B = "77777777-7777-4777-8777-777777777778";
const USER = "77777777-7777-4777-8777-777777777777";
const SESSION = "88888888-8888-4888-8888-888888888888";
const KEYS = [{ kid: "k1", secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef") }];
const API = "/api/v1/clinic-portal";
// Canários: textos que nunca podem aparecer na auditoria.
const CANARY_NAME = "Dra. Canario Segredo";
const CANARY_SPECIALTY = "Especialidade Canario";
const CANARY_SERVICE = "Servico Canario";
const CANARY_REASON = "motivo-canario-privado";

async function buildHarness() {
  const clock = new FixedClock(NOW);
  const fx = createClinicsFixtures(clock);
  const { deps } = fx;
  const controller = {
    listOwnClinicSlots: createListOwnClinicSlotsUseCase(deps),
    publishClinicSlots: createPublishClinicSlotsUseCase(deps),
    updateClinicSlot: createUpdateClinicSlotUseCase(deps),
    removeClinicSlot: createRemoveClinicSlotUseCase(deps),
    listClinicProfessionals: createListClinicProfessionalsUseCase(deps),
    createClinicProfessional: createCreateClinicProfessionalUseCase(deps),
    updateClinicProfessional: createUpdateClinicProfessionalUseCase(deps),
    listClinicServiceTypes: createListClinicServiceTypesUseCase(deps),
    listClinicExamServiceTypes: createListClinicExamServiceTypesUseCase(deps),
    createClinicServiceType: createCreateClinicServiceTypeUseCase(deps),
    updateClinicServiceType: createUpdateClinicServiceTypeUseCase(deps),
    listClinicScheduleRules: createListClinicScheduleRulesUseCase(deps),
    createClinicScheduleRule: createCreateClinicScheduleRuleUseCase(deps),
    updateClinicScheduleRule: createUpdateClinicScheduleRuleUseCase(deps),
    regenerateClinicScheduleRule: createRegenerateClinicScheduleRuleUseCase(deps),
    listClinicTimeOff: createListClinicTimeOffUseCase(deps),
    createClinicTimeOff: createCreateClinicTimeOffUseCase(deps),
    deleteClinicTimeOff: createDeleteClinicTimeOffUseCase(deps),
  } as unknown as ClinicPortalController;

  const app = createApp({
    openApiSpecPath: OPENAPI_SPEC_PATH,
    logger: createLogger({ level: "silent" }),
    securityHandlers: {
      bearerAuth: createBearerAuthSecurityHandler({ signingKeys: KEYS, clock }),
      clinicBearerAuth: createClinicBearerAuthSecurityHandler({ signingKeys: KEYS, clock }),
    },
    actorContextMiddleware: createClinicActorContextMiddleware({
      resolveClinicActorState: (clinicAccountId, sessionId) =>
        Promise.resolve({
          clinicAccountId,
          sessionId,
          clinicId: clinicAccountId === ACCOUNT_B ? CLINIC_B : CLINIC_A,
          role: clinicAccountId === ACCOUNT_ADMIN ? ("CLINIC_ADMIN" as const) : ("CLINIC_MANAGER" as const),
          suspended: false,
        }),
    }),
    registerHealthRoutes: (router) => {
      router.get("/health", (_req, res) => res.json({ status: "ok" }));
    },
    registerRoutes: (router) => {
      router.use(createClinicPortalRouter(controller, "localhost"));
    },
  });
  const clinicToken = async (account: string) => (await signClinicAccessToken({ subject: { clinicAccountId: account, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token;
  return {
    app,
    fx,
    userToken: (await signAccessToken({ subject: { userId: USER, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token,
    insuranceToken: (await signInsuranceAccessToken({ subject: { insuranceAccountId: ACCOUNT_ADMIN, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token,
    admin: await clinicToken(ACCOUNT_ADMIN),
    manager: await clinicToken(ACCOUNT_MANAGER),
    other: await clinicToken(ACCOUNT_B),
  };
}

type H = Awaited<ReturnType<typeof buildHarness>>;
const call = (h: H, method: "get" | "post" | "patch" | "delete", path: string, token: string, body?: Record<string, unknown>) => {
  const req = request(h.app)[method](`${API}${path}`).set("Authorization", `Bearer ${token}`);
  return body ? req.send(body) : req;
};

async function seed(h: H) {
  const professional = (await call(h, "post", "/professionals", h.admin, { name: CANARY_NAME, specialty: CANARY_SPECIALTY })).body as { id: string };
  const service = (await call(h, "post", "/services", h.admin, { name: CANARY_SERVICE, kind: "APPOINTMENT", durationMinutes: 30, priceMinor: 1_500_000 })).body as { id: string };
  return { professionalId: professional.id, serviceTypeId: service.id };
}

describe("autenticação e papéis (authorization.md §6.2)", () => {
  let h: H;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it.each([
    ["get", "/professionals"],
    ["get", "/services"],
    ["get", "/schedule-rules"],
    ["get", "/time-off"],
  ] as const)("%s %s: 401 sem token; token de User e de seguradora rejeitados; ambos os papéis 200", async (method, path) => {
    expect((await request(h.app)[method](`${API}${path}`)).status).toBe(401);
    expect((await call(h, method, path, h.userToken)).status).toBe(401);
    expect((await call(h, method, path, h.insuranceToken)).status).toBe(401);
    expect((await call(h, method, path, h.admin)).status).toBe(200);
    expect((await call(h, method, path, h.manager)).status).toBe(200);
  });

  it("Admin e Gestor têm as mesmas permissões de escrita (catálogo, regras, bloqueios)", async () => {
    for (const token of [h.admin, h.manager]) {
      const professional = await call(h, "post", "/professionals", token, { name: `P ${token.slice(-6)}` });
      expect(professional.status).toBe(201);
      const service = await call(h, "post", "/services", token, { name: `S ${token.slice(-6)}`, kind: "EXAM", durationMinutes: 30 });
      expect(service.status).toBe(201);
      const pid = (professional.body as { id: string }).id;
      const sid = (service.body as { id: string }).id;
      const rule = await call(h, "post", "/schedule-rules", token, { professionalId: pid, serviceTypeId: sid, weekdays: [1], startTime: "09:00", endTime: "10:00", capacity: 2 });
      expect(rule.status).toBe(201);
      const off = await call(h, "post", "/time-off", token, { professionalId: pid, startsAt: "2026-10-13T00:00:00Z", endsAt: "2026-10-14T00:00:00Z" });
      expect(off.status).toBe(201);
      expect((await call(h, "delete", `/time-off/${(off.body as { timeOff: { id: string } }).timeOff.id}`, token)).status).toBe(200);
    }
  });
});

describe("catálogo (AC-CLN-07)", () => {
  let h: H;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("201 com currency=AOA e sem DELETE; nome duplicado 409; preço negativo, duração 25 e kind no PATCH 422; desativar e listar com filtros", async () => {
    const service = await call(h, "post", "/services", h.manager, { name: "Ecografia", kind: "EXAM", durationMinutes: 30, priceMinor: 1_500_000 });
    expect(service.status).toBe(201);
    expect(service.body).toMatchObject({ kind: "EXAM", durationMinutes: 30, priceMinor: 1_500_000, currency: "AOA", active: true });
    const id = (service.body as { id: string }).id;

    expect((await call(h, "post", "/services", h.admin, { name: "ecografia", kind: "EXAM", durationMinutes: 30 })).status).toBe(409);
    expect((await call(h, "post", "/services", h.admin, { name: "X", kind: "EXAM", durationMinutes: 30, priceMinor: -1 })).status).toBe(422);
    expect((await call(h, "post", "/services", h.admin, { name: "X", kind: "EXAM", durationMinutes: 25 })).status).toBe(422);
    expect((await call(h, "post", "/services", h.admin, { name: "X", kind: "EXAM", durationMinutes: 30, currency: "EUR" })).status).toBe(422);
    expect((await call(h, "patch", `/services/${id}`, h.admin, { kind: "APPOINTMENT" })).status).toBe(422);
    expect((await call(h, "patch", `/services/${id}`, h.admin, {})).status).toBe(422);
    expect((await call(h, "delete", `/services/${id}`, h.admin)).status).toBeGreaterThanOrEqual(400); // sem DELETE no contrato

    expect((await call(h, "patch", `/services/${id}`, h.admin, { active: false })).body).toMatchObject({ active: false });
    expect((await call(h, "get", "/services?active=false", h.admin)).body).toHaveLength(1);
    expect((await call(h, "get", "/services?active=true", h.admin)).body).toHaveLength(0);
    expect((await call(h, "get", "/services?kind=EXAM", h.admin)).body).toHaveLength(1);
    expect((await call(h, "get", "/services?kind=APPOINTMENT", h.admin)).body).toHaveLength(0);
  });

  it("profissionais: criar, listar, desativar; nome vazio ou longo 422", async () => {
    const created = await call(h, "post", "/professionals", h.admin, { name: "Dr. Costa", specialty: "Ortopedia" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Dr. Costa", specialty: "Ortopedia", active: true });
    expect((await call(h, "post", "/professionals", h.admin, { name: "" })).status).toBe(422);
    expect((await call(h, "post", "/professionals", h.admin, { name: "a".repeat(121) })).status).toBe(422);
    const id = (created.body as { id: string }).id;
    expect((await call(h, "patch", `/professionals/${id}`, h.manager, { active: false })).body).toMatchObject({ active: false });
    expect((await call(h, "get", "/professionals?active=false", h.manager)).body).toHaveLength(1);
  });

  it("isolamento: a clínica B nunca vê nem altera (lista vazia / 404)", async () => {
    const { professionalId, serviceTypeId } = await seed(h);
    expect((await call(h, "get", "/professionals", h.other)).body).toEqual([]);
    expect((await call(h, "get", "/services", h.other)).body).toEqual([]);
    expect((await call(h, "patch", `/professionals/${professionalId}`, h.other, { active: false })).status).toBe(404);
    expect((await call(h, "patch", `/services/${serviceTypeId}`, h.other, { active: false })).status).toBe(404);
  });
});

describe("regras, geração e horários (AC-CLN-08/09/11)", () => {
  let h: H;
  beforeEach(async () => {
    h = await buildHarness();
  });

  const ruleBody = (ids: { professionalId: string; serviceTypeId: string }, extra: Record<string, unknown> = {}) => ({ ...ids, weekdays: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "11:00", ...extra });

  it("201 com a geração (160 horários em 8 semanas); regenerar é idempotente; GET /slots traz profissional/serviço/regra", async () => {
    const ids = await seed(h);
    const created = await call(h, "post", "/schedule-rules", h.manager, ruleBody(ids));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ rule: { ...ids, weekdays: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "11:00", validFrom: null, validUntil: null, capacity: 1, active: true }, generation: { created: 160, unchanged: 0, removed: 0, skippedOverlap: 0, skippedTimeOff: 0, keptBooked: 0 } });
    const ruleId = (created.body as { rule: { id: string } }).rule.id;

    const again = await call(h, "post", `/schedule-rules/${ruleId}/regenerate`, h.admin);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ generation: { created: 0, unchanged: 160 } });

    const slots = (await call(h, "get", "/slots", h.admin)).body as { professionalId: string; serviceTypeId: string; scheduleRuleId: string; specialty: string; kind: string }[];
    expect(slots).toHaveLength(160);
    expect(slots[0]).toMatchObject({ ...ids, scheduleRuleId: ruleId, specialty: CANARY_SERVICE, kind: "APPOINTMENT" });
  });

  it("DELETE de horário gerado => 409; PATCH capacity continua a funcionar em exames gerados", async () => {
    const professional = (await call(h, "post", "/professionals", h.admin, { name: "T" })).body as { id: string };
    const exam = (await call(h, "post", "/services", h.admin, { name: "Eco", kind: "EXAM", durationMinutes: 60 })).body as { id: string };
    await call(h, "post", "/schedule-rules", h.admin, { professionalId: professional.id, serviceTypeId: exam.id, weekdays: [1], startTime: "09:00", endTime: "10:00", capacity: 2 });
    const [slot] = (await call(h, "get", "/slots", h.admin)).body as { id: string }[];
    expect((await call(h, "delete", `/slots/${slot?.id ?? ""}`, h.admin)).status).toBe(409);
    expect((await call(h, "patch", `/slots/${slot?.id ?? ""}`, h.admin, { capacity: 4 })).body).toMatchObject({ capacity: 4 });
  });

  it("POST /slots com serviceTypeId de exame (o default `kind` do contrato não gera 422) e com professionalId (sobreposição => 409)", async () => {
    const professional = (await call(h, "post", "/professionals", h.admin, { name: "P" })).body as { id: string };
    const exam = (await call(h, "post", "/services", h.admin, { name: "Eco", kind: "EXAM", durationMinutes: 30 })).body as { id: string };
    const ok = await call(h, "post", "/slots", h.admin, { date: "2026-10-20", times: ["09:00"], serviceTypeId: exam.id, professionalId: professional.id, capacity: 3 });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject([{ kind: "EXAM", specialty: "Eco", durationMinutes: 30, capacity: 3, professionalId: professional.id, serviceTypeId: exam.id, scheduleRuleId: null }]);
    expect((await call(h, "post", "/slots", h.admin, { date: "2026-10-20", times: ["09:15"], serviceTypeId: exam.id, professionalId: professional.id })).status).toBe(409);
    expect((await call(h, "post", "/slots", h.admin, { date: "2026-10-20", times: ["09:30"], serviceTypeId: exam.id, professionalId: professional.id })).status).toBe(201);
    expect((await call(h, "post", "/slots", h.admin, { date: "2026-10-20", times: ["09:30"], serviceTypeId: exam.id, professionalId: professional.id, durationMinutes: 45 })).status).toBe(422);
    // Sem serviço: specialty/durationMinutes continuam obrigatórios (422), o contrato deixou de os exigir no schema.
    expect((await call(h, "post", "/slots", h.admin, { date: "2026-10-20", times: ["12:00"] })).status).toBe(422);
    expect((await call(h, "post", "/slots", h.admin, { date: "2026-10-20", times: ["12:00"], specialty: "Geral", durationMinutes: 30 })).status).toBe(201);
  });

  it("422: dias repetidos, hora inválida, intervalo < duração; 409 regra sobreposta; 404 profissional de outra clínica", async () => {
    const ids = await seed(h);
    expect((await call(h, "post", "/schedule-rules", h.admin, ruleBody(ids, { weekdays: [1, 1] }))).status).toBe(422);
    expect((await call(h, "post", "/schedule-rules", h.admin, ruleBody(ids, { startTime: "9:00" }))).status).toBe(422);
    expect((await call(h, "post", "/schedule-rules", h.admin, ruleBody(ids, { endTime: "09:15" }))).status).toBe(422);
    expect((await call(h, "post", "/schedule-rules", h.admin, ruleBody(ids, { capacity: 2 }))).status).toBe(422);
    expect((await call(h, "post", "/schedule-rules", h.admin, ruleBody(ids))).status).toBe(201);
    expect((await call(h, "post", "/schedule-rules", h.admin, ruleBody(ids, { startTime: "10:30", endTime: "12:00" }))).status).toBe(409);
    expect((await call(h, "post", "/schedule-rules", h.other, ruleBody(ids))).status).toBe(404);
  });

  it("PATCH desativa (remove os livres: removed=160), não altera professionalId (422), regra de outra clínica 404", async () => {
    const ids = await seed(h);
    const ruleId = ((await call(h, "post", "/schedule-rules", h.admin, ruleBody(ids))).body as { rule: { id: string } }).rule.id;
    expect((await call(h, "patch", `/schedule-rules/${ruleId}`, h.admin, { professionalId: ids.professionalId })).status).toBe(422);
    expect((await call(h, "patch", `/schedule-rules/${ruleId}`, h.other, { active: false })).status).toBe(404);
    expect((await call(h, "post", `/schedule-rules/${ruleId}/regenerate`, h.other)).status).toBe(404);
    const off = await call(h, "patch", `/schedule-rules/${ruleId}`, h.manager, { active: false });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ rule: { active: false }, generation: { removed: 160, keptBooked: 0, created: 0 } });
    expect((await call(h, "get", "/slots", h.admin)).body).toEqual([]);
    expect((await call(h, "get", "/schedule-rules", h.other)).body).toEqual([]);
    expect((await call(h, "get", `/schedule-rules?professionalId=${ids.professionalId}&active=false`, h.admin)).body).toHaveLength(1);
  });
});

describe("bloqueios (AC-CLN-10)", () => {
  let h: H;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("201 com removedSlots/bookedSlots (sem PII), bookedSlotCount na listagem, remoção regenera; 422 intervalos inválidos; 404 outra clínica", async () => {
    const ids = await seed(h);
    await call(h, "post", "/schedule-rules", h.admin, { ...ids, weekdays: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "11:00" });
    const res = await request(h.app).get(`${API}/slots`).query({ from: "2026-10-13T00:00:00Z", to: "2026-10-13T23:59:00Z" }).set("Authorization", `Bearer ${h.admin}`);
    const slots = res.body as { id: string }[];
    if (!Array.isArray(slots)) throw new Error(JSON.stringify(slots));
    expect(slots).toHaveLength(4);
    h.fx.slotOccupancy.book(slots[0]?.id ?? "");
    h.fx.slotOccupancy.book(slots[1]?.id ?? "", "requested");

    const created = await call(h, "post", "/time-off", h.admin, { professionalId: ids.professionalId, startsAt: "2026-10-13T00:00:00Z", endsAt: "2026-10-14T00:00:00Z", reason: CANARY_REASON });
    expect(created.status).toBe(201);
    const body = created.body as { timeOff: { id: string; bookedSlotCount: number }; removedSlots: number; bookedSlots: Record<string, unknown>[] };
    expect(body.removedSlots).toBe(2);
    expect(body.bookedSlots).toHaveLength(2);
    expect(Object.keys(body.bookedSlots[0] ?? {}).sort()).toEqual(["bookedCount", "durationMinutes", "kind", "slotId", "startsAt"]);

    const list = (await call(h, "get", "/time-off", h.manager)).body as { bookedSlotCount: number; reason: string }[];
    expect(list).toEqual([expect.objectContaining({ bookedSlotCount: 2, reason: CANARY_REASON })]);
    expect((await call(h, "get", "/time-off", h.other)).body).toEqual([]);
    expect((await call(h, "delete", `/time-off/${body.timeOff.id}`, h.other)).status).toBe(404);

    const removed = await call(h, "delete", `/time-off/${body.timeOff.id}`, h.admin);
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ created: 2, unchanged: 2, removed: 0, skippedOverlap: 0, skippedTimeOff: 0, keptBooked: 0 });

    for (const bad of [
      { startsAt: "2026-10-14T00:00:00Z", endsAt: "2026-10-13T00:00:00Z" },
      { startsAt: "2026-10-13T00:00:00Z", endsAt: "2027-10-20T00:00:00Z" },
      { startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-09-02T00:00:00Z" },
    ]) {
      expect((await call(h, "post", "/time-off", h.admin, { professionalId: ids.professionalId, ...bad })).status).toBe(422);
    }
    expect((await call(h, "post", "/time-off", h.other, { professionalId: ids.professionalId, startsAt: "2026-10-13T00:00:00Z", endsAt: "2026-10-14T00:00:00Z" })).status).toBe(404);
  });

  it("publicar manualmente com professionalId no intervalo bloqueado => 409", async () => {
    const ids = await seed(h);
    await call(h, "post", "/time-off", h.admin, { professionalId: ids.professionalId, startsAt: "2026-10-13T00:00:00Z", endsAt: "2026-10-14T00:00:00Z" });
    expect((await call(h, "post", "/slots", h.admin, { date: "2026-10-13", times: ["10:00"], serviceTypeId: ids.serviceTypeId, professionalId: ids.professionalId })).status).toBe(409);
  });
});

describe("auditoria sem PII (canários)", () => {
  it("nenhum nome, especialidade, serviço, preço ou motivo aparece nos eventos de auditoria", async () => {
    const h = await buildHarness();
    const ids = await seed(h);
    const rule = (await call(h, "post", "/schedule-rules", h.admin, { ...ids, weekdays: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "11:00" })).body as { rule: { id: string } };
    await call(h, "patch", `/schedule-rules/${rule.rule.id}`, h.admin, { endTime: "10:00" });
    await call(h, "post", `/schedule-rules/${rule.rule.id}/regenerate`, h.admin);
    const off = (await call(h, "post", "/time-off", h.admin, { professionalId: ids.professionalId, startsAt: "2026-10-13T00:00:00Z", endsAt: "2026-10-14T00:00:00Z", reason: CANARY_REASON })).body as { timeOff: { id: string } };
    await call(h, "delete", `/time-off/${off.timeOff.id}`, h.admin);
    await call(h, "patch", `/professionals/${ids.professionalId}`, h.admin, { active: false });
    await call(h, "patch", `/services/${ids.serviceTypeId}`, h.admin, { active: false });

    const actions = h.fx.audit.events.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["CLINIC_PROFESSIONAL_CREATE", "CLINIC_SERVICE_CREATE", "CLINIC_SCHEDULE_RULE_CREATE", "CLINIC_SCHEDULE_RULE_UPDATE", "CLINIC_SCHEDULE_RULE_REGENERATE", "CLINIC_TIME_OFF_CREATE", "CLINIC_TIME_OFF_DELETE", "CLINIC_PROFESSIONAL_UPDATE", "CLINIC_SERVICE_UPDATE"]));
    const serialized = JSON.stringify(h.fx.audit.events);
    for (const canary of [CANARY_NAME, CANARY_SPECIALTY, CANARY_SERVICE, CANARY_REASON, "1500000", "Canario"]) {
      expect(serialized).not.toContain(canary);
    }
    expect(h.fx.audit.events.every((e) => e.actorType === "CLINIC_ACCOUNT" && e.familyId === undefined && e.subjectMemberId === undefined)).toBe(true);
  });
});

describe("GET /clinic-portal/exam-service-types (M15 U, BR-CLN-51, authorization.md §6.2b)", () => {
  let h: H;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("só serviços EXAM ativos, por nome, projeção mínima sem preço; 401 sem token/User/seguradora; Admin e Gestor 200", async () => {
    await call(h, "post", "/services", h.admin, { name: "Zeta eco", kind: "EXAM", durationMinutes: 30, priceMinor: 5000 });
    await call(h, "post", "/services", h.admin, { name: "Alfa análises", kind: "EXAM", durationMinutes: 15, priceMinor: 100 });
    await call(h, "post", "/services", h.admin, { name: "Consulta", kind: "APPOINTMENT", durationMinutes: 30 });
    const off = (await call(h, "post", "/services", h.admin, { name: "Inativo", kind: "EXAM", durationMinutes: 30 })).body as { id: string };
    await call(h, "patch", `/services/${off.id}`, h.admin, { active: false });
    expect((await request(h.app).get(`${API}/exam-service-types`)).status).toBe(401);
    expect((await call(h, "get", "/exam-service-types", h.userToken)).status).toBe(401);
    expect((await call(h, "get", "/exam-service-types", h.insuranceToken)).status).toBe(401);
    for (const token of [h.admin, h.manager]) {
      const res = await call(h, "get", "/exam-service-types", token);
      expect(res.status).toBe(200);
      const items = res.body as Record<string, unknown>[];
      expect(items.map((i) => i.name)).toEqual(["Alfa análises", "Zeta eco"]);
      expect(Object.keys(items[0] ?? {}).sort()).toEqual(["durationMinutes", "id", "name"]);
    }
  });

  it("isolamento: a clínica B não vê os serviços da A", async () => {
    await call(h, "post", "/services", h.admin, { name: "Eco A", kind: "EXAM", durationMinutes: 30 });
    expect((await call(h, "get", "/exam-service-types", h.other)).body).toEqual([]);
  });
});
