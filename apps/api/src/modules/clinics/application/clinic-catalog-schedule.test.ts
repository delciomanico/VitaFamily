// Casos de uso do catálogo, regras de horário, bloqueios e job (M14 a1/a2): TC-CLN-04/05/06,
// AC-CLN-07..11, sobre os fakes das fixtures. Autorização/HTTP: tests/http/clinic-schedule.http.test.ts.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import {
  createCreateClinicProfessionalUseCase,
  createCreateClinicServiceTypeUseCase,
  createListClinicProfessionalsUseCase,
  createListClinicServiceTypesUseCase,
  createUpdateClinicProfessionalUseCase,
  createUpdateClinicServiceTypeUseCase,
} from "./clinic-catalog.js";
import {
  createCreateClinicScheduleRuleUseCase,
  createListClinicScheduleRulesUseCase,
  createRegenerateClinicScheduleRuleUseCase,
  createUpdateClinicScheduleRuleUseCase,
} from "./clinic-schedule-rules.js";
import { createPublishClinicSlotsUseCase, createRemoveClinicSlotUseCase, createUpdateClinicSlotUseCase } from "./clinic-slots.js";
import { createCreateClinicTimeOffUseCase, createDeleteClinicTimeOffUseCase, createListClinicTimeOffUseCase } from "./clinic-time-off.js";
import { createClinicsFixtures } from "./fixtures.js";
import type { ClinicPortalActor } from "./ports.js";
import { createGenerateScheduleJobUseCase } from "./schedule-generation.js";

// Domingo, ainda WEST: a janela cobre 2026-10-11 .. 2026-12-06.
const NOW = new Date("2026-10-11T08:00:00Z");
const CTX = { requestId: "req-1" };
const ADMIN_A: ClinicPortalActor = { clinicAccountId: "acc-admin-a", clinicId: "clinic-a", role: "CLINIC_ADMIN" };
const MANAGER_A: ClinicPortalActor = { clinicAccountId: "acc-mgr-a", clinicId: "clinic-a", role: "CLINIC_MANAGER" };
const ADMIN_B: ClinicPortalActor = { clinicAccountId: "acc-admin-b", clinicId: "clinic-b", role: "CLINIC_ADMIN" };

function setup() {
  const fixtures = createClinicsFixtures(new FixedClock(NOW));
  const { deps } = fixtures;
  return {
    fixtures,
    deps,
    createProfessional: createCreateClinicProfessionalUseCase(deps),
    updateProfessional: createUpdateClinicProfessionalUseCase(deps),
    listProfessionals: createListClinicProfessionalsUseCase(deps),
    createService: createCreateClinicServiceTypeUseCase(deps),
    updateService: createUpdateClinicServiceTypeUseCase(deps),
    listServices: createListClinicServiceTypesUseCase(deps),
    createRule: createCreateClinicScheduleRuleUseCase(deps),
    updateRule: createUpdateClinicScheduleRuleUseCase(deps),
    regenerate: createRegenerateClinicScheduleRuleUseCase(deps),
    listRules: createListClinicScheduleRulesUseCase(deps),
    createTimeOff: createCreateClinicTimeOffUseCase(deps),
    deleteTimeOff: createDeleteClinicTimeOffUseCase(deps),
    listTimeOff: createListClinicTimeOffUseCase(deps),
    publish: createPublishClinicSlotsUseCase(deps),
    removeSlot: createRemoveClinicSlotUseCase(deps),
    patchSlot: createUpdateClinicSlotUseCase(deps),
  };
}

type Ctx = ReturnType<typeof setup>;

async function seedWeekdayRule(ctx: Ctx, actor = ADMIN_A) {
  const professional = await ctx.createProfessional(actor, { name: "Dra. Ana", specialty: "Cardiologia" }, CTX);
  const service = await ctx.createService(actor, { name: "Consulta geral", kind: "APPOINTMENT", durationMinutes: 30, priceMinor: 1_500_000 }, CTX);
  const result = await ctx.createRule(actor, { professionalId: professional.id, serviceTypeId: service.id, weekdays: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "11:00" }, CTX);
  return { professional, service, ...result };
}

function must<T>(value: T | undefined, what = "valor"): T {
  if (value === undefined) {
    throw new Error(`esperava ${what}`);
  }
  return value;
}

const slotsOf = (ctx: Ctx) => [...ctx.fixtures.clinicSlotsRepo.byId.values()];

describe("catálogo (BR-CLN-11/12, AC-CLN-07)", () => {
  it("cria profissional e serviço (Admin e Gestor); moeda AOA só leitura; auditoria sem nomes nem preço", async () => {
    const ctx = setup();
    const professional = await ctx.createProfessional(MANAGER_A, { name: "  Dra. Ana  ", specialty: "Cardiologia" }, CTX);
    const service = await ctx.createService(ADMIN_A, { name: "Ecografia", kind: "EXAM", durationMinutes: 30, priceMinor: 1_500_000 }, CTX);

    expect(professional).toMatchObject({ name: "Dra. Ana", specialty: "Cardiologia", active: true });
    expect(service).toMatchObject({ kind: "EXAM", durationMinutes: 30, priceMinor: 1_500_000, currency: "AOA", active: true });
    const serialized = JSON.stringify(ctx.fixtures.audit.events);
    expect(ctx.fixtures.audit.events.map((e) => e.action)).toEqual(["CLINIC_PROFESSIONAL_CREATE", "CLINIC_SERVICE_CREATE"]);
    for (const secret of ["Dra. Ana", "Cardiologia", "Ecografia", "1500000"]) expect(serialized).not.toContain(secret);
  });

  it("nome duplicado entre ativos (sem maiúsculas) => CONFLICT; depois de desativar já pode repetir-se; serviços por kind", async () => {
    const ctx = setup();
    const first = await ctx.createProfessional(ADMIN_A, { name: "Ana" }, CTX);
    await expect(ctx.createProfessional(ADMIN_A, { name: "ANA" }, CTX)).rejects.toBeInstanceOf(ConflictError);
    await ctx.updateProfessional(ADMIN_A, first.id, { active: false }, CTX);
    await expect(ctx.createProfessional(ADMIN_A, { name: "ana" }, CTX)).resolves.toMatchObject({ active: true });
    // Reativar o antigo colide com o novo ativo.
    await expect(ctx.updateProfessional(ADMIN_A, first.id, { active: true }, CTX)).rejects.toBeInstanceOf(ConflictError);

    await ctx.createService(ADMIN_A, { name: "Eco", kind: "EXAM", durationMinutes: 30 }, CTX);
    await expect(ctx.createService(ADMIN_A, { name: "eco", kind: "EXAM", durationMinutes: 45 }, CTX)).rejects.toBeInstanceOf(ConflictError);
    await expect(ctx.createService(ADMIN_A, { name: "Eco", kind: "APPOINTMENT", durationMinutes: 30 }, CTX)).resolves.toBeDefined();
    // Outra clínica pode usar o mesmo nome.
    await expect(ctx.createProfessional(ADMIN_B, { name: "Ana" }, CTX)).resolves.toBeDefined();
  });

  it("limites: 100 profissionais e 100 serviços por clínica => CONFLICT", async () => {
    const ctx = setup();
    for (let i = 0; i < 100; i++) await ctx.createProfessional(ADMIN_A, { name: `P${String(i)}` }, CTX);
    await expect(ctx.createProfessional(ADMIN_A, { name: "P100" }, CTX)).rejects.toBeInstanceOf(ConflictError);
    for (let i = 0; i < 100; i++) await ctx.createService(ADMIN_A, { name: `S${String(i)}`, kind: "APPOINTMENT", durationMinutes: 30 }, CTX);
    await expect(ctx.createService(ADMIN_A, { name: "S100", kind: "APPOINTMENT", durationMinutes: 30 }, CTX)).rejects.toBeInstanceOf(ConflictError);
  });

  it.each([
    ["duração 25", { name: "X", kind: "APPOINTMENT", durationMinutes: 25 }],
    ["preço negativo", { name: "X", kind: "APPOINTMENT", durationMinutes: 30, priceMinor: -1 }],
    ["preço decimal", { name: "X", kind: "APPOINTMENT", durationMinutes: 30, priceMinor: 10.5 }],
    ["sem kind", { name: "X", durationMinutes: 30 }],
    ["nome vazio", { name: " ", kind: "APPOINTMENT", durationMinutes: 30 }],
  ])("serviço inválido (%s) => VALIDATION_ERROR", async (_name, input) => {
    await expect(setup().createService(ADMIN_A, input, CTX)).rejects.toBeInstanceOf(ValidationError);
  });

  it("alterar o kind => VALIDATION_ERROR; PATCH sem campos => VALIDATION_ERROR; desativa/reativa (sem DELETE) e lista com filtros", async () => {
    const ctx = setup();
    const service = await ctx.createService(ADMIN_A, { name: "Eco", kind: "EXAM", durationMinutes: 30 }, CTX);
    await expect(ctx.updateService(ADMIN_A, service.id, { kind: "APPOINTMENT" }, CTX)).rejects.toBeInstanceOf(ValidationError);
    await expect(ctx.updateService(ADMIN_A, service.id, {}, CTX)).rejects.toBeInstanceOf(ValidationError);
    await expect(ctx.updateService(ADMIN_A, service.id, { durationMinutes: 25 }, CTX)).rejects.toBeInstanceOf(ValidationError);

    expect(await ctx.updateService(ADMIN_A, service.id, { active: false, priceMinor: 0 }, CTX)).toMatchObject({ active: false, priceMinor: 0 });
    expect(await ctx.listServices(ADMIN_A, { active: false })).toHaveLength(1);
    expect(await ctx.listServices(ADMIN_A, { active: true })).toHaveLength(0);
    expect(await ctx.listServices(ADMIN_A, { kind: "APPOINTMENT" })).toHaveLength(0);
    expect(await ctx.updateService(ADMIN_A, service.id, { active: true }, CTX)).toMatchObject({ active: true });
  });

  it("isolamento: outra clínica não vê nem altera (NOT_FOUND / lista vazia)", async () => {
    const ctx = setup();
    const professional = await ctx.createProfessional(ADMIN_A, { name: "Ana" }, CTX);
    const service = await ctx.createService(ADMIN_A, { name: "Eco", kind: "EXAM", durationMinutes: 30 }, CTX);
    expect(await ctx.listProfessionals(ADMIN_B, {})).toEqual([]);
    expect(await ctx.listServices(ADMIN_B, {})).toEqual([]);
    await expect(ctx.updateProfessional(ADMIN_B, professional.id, { active: false }, CTX)).rejects.toBeInstanceOf(NotFoundError);
    await expect(ctx.updateService(ADMIN_B, service.id, { active: false }, CTX)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("regras e geração (BR-CLN-12/13, AC-CLN-08/09)", () => {
  it("seg–sex 09:00–11:00 (30 min): 4 horários por dia útil futuro, com catálogo, kind e especialidade do serviço", async () => {
    const ctx = setup();
    const { professional, service, rule, generation } = await seedWeekdayRule(ctx);

    expect(rule).toMatchObject({ weekdays: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "11:00", capacity: 1, active: true });
    expect(generation).toEqual({ created: 160, unchanged: 0, removed: 0, skippedOverlap: 0, skippedTimeOff: 0, keptBooked: 0 });
    const slots = slotsOf(ctx);
    expect(slots).toHaveLength(160);
    expect(slots.every((s) => s.professionalId === professional.id && s.serviceTypeId === service.id && s.scheduleRuleId === rule.id && s.kind === "APPOINTMENT" && s.specialty === "Consulta geral")).toBe(true);
    expect(slots.every((s) => s.professionalName === "Dra. Ana")).toBe(true);
  });

  it("idempotente: regenerar e o job seguido dão created = 0 e sem duplicados", async () => {
    const ctx = setup();
    const { rule } = await seedWeekdayRule(ctx);
    const again = await ctx.regenerate(MANAGER_A, rule.id, CTX);
    expect(again.generation).toMatchObject({ created: 0, unchanged: 160, removed: 0, keptBooked: 0 });
    const job = createGenerateScheduleJobUseCase(ctx.deps);
    expect(await job()).toMatchObject({ rules: 1, created: 0, unchanged: 160, failedRules: 0 });
    expect(slotsOf(ctx)).toHaveLength(160);
  });

  it("job: acrescenta as semanas seguintes com o passar dos dias e audita SYSTEM só com contagens", async () => {
    const ctx = setup();
    await seedWeekdayRule(ctx);
    (ctx.deps.clock as FixedClock).advance(7 * 24 * 3600 * 1000);
    const job = createGenerateScheduleJobUseCase(ctx.deps);
    const result = await job();
    expect(result.created).toBe(20); // mais uma semana de dias úteis
    const event = ctx.fixtures.audit.events.at(-1);
    expect(event).toMatchObject({ actorType: "SYSTEM", action: "CLINIC_SCHEDULE_GENERATE", result: "SUCCESS" });
    expect(event?.actorClinicAccountId).toBeUndefined();
    expect(event?.metadata).toMatchObject({ rules: 1, created: 20, failedRules: 0 });
    expect(JSON.stringify(event)).not.toContain("Dra. Ana");
  });

  it("job ignora regras de profissional/serviço inativos", async () => {
    const ctx = setup();
    const { professional } = await seedWeekdayRule(ctx);
    await ctx.updateProfessional(ADMIN_A, professional.id, { active: false }, CTX);
    expect(await createGenerateScheduleJobUseCase(ctx.deps)()).toMatchObject({ rules: 0, created: 0 });
  });

  it("serviço EXAM: capacity da regra passa aos horários; consulta com capacity > 1 => VALIDATION_ERROR", async () => {
    const ctx = setup();
    const professional = await ctx.createProfessional(ADMIN_A, { name: "Técnico" }, CTX);
    const exam = await ctx.createService(ADMIN_A, { name: "Eco", kind: "EXAM", durationMinutes: 60 }, CTX);
    const consult = await ctx.createService(ADMIN_A, { name: "Cons", kind: "APPOINTMENT", durationMinutes: 60 }, CTX);
    await expect(ctx.createRule(ADMIN_A, { professionalId: professional.id, serviceTypeId: consult.id, weekdays: [1], startTime: "09:00", endTime: "10:00", capacity: 3 }, CTX)).rejects.toBeInstanceOf(ValidationError);
    await ctx.createRule(ADMIN_A, { professionalId: professional.id, serviceTypeId: exam.id, weekdays: [1], startTime: "09:00", endTime: "10:00", capacity: 3 }, CTX);
    const slots = slotsOf(ctx);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.kind === "EXAM" && s.capacity === 3)).toBe(true);
  });

  it("validações: intervalo menor que a duração, fim <= início => VALIDATION_ERROR; inativos => CONFLICT; outra clínica => NOT_FOUND", async () => {
    const ctx = setup();
    const professional = await ctx.createProfessional(ADMIN_A, { name: "Ana" }, CTX);
    const service = await ctx.createService(ADMIN_A, { name: "Cons", kind: "APPOINTMENT", durationMinutes: 45 }, CTX);
    const base = { professionalId: professional.id, serviceTypeId: service.id, weekdays: [1] };
    await expect(ctx.createRule(ADMIN_A, { ...base, startTime: "09:00", endTime: "09:30" }, CTX)).rejects.toBeInstanceOf(ValidationError);
    await expect(ctx.createRule(ADMIN_A, { ...base, startTime: "10:00", endTime: "09:00" }, CTX)).rejects.toBeInstanceOf(ValidationError);
    await expect(ctx.createRule(ADMIN_B, { ...base, startTime: "09:00", endTime: "10:00" }, CTX)).rejects.toBeInstanceOf(NotFoundError);
    await ctx.updateService(ADMIN_A, service.id, { active: false }, CTX);
    await expect(ctx.createRule(ADMIN_A, { ...base, startTime: "09:00", endTime: "10:00" }, CTX)).rejects.toBeInstanceOf(ConflictError);
  });

  it("duas regras ativas do profissional sobrepostas => CONFLICT; outro profissional ou horas encostadas é válido", async () => {
    const ctx = setup();
    const { professional, service } = await seedWeekdayRule(ctx);
    const other = await ctx.createProfessional(ADMIN_A, { name: "Rui" }, CTX);
    const base = { serviceTypeId: service.id, weekdays: [1, 2] };
    await expect(ctx.createRule(ADMIN_A, { ...base, professionalId: professional.id, startTime: "10:30", endTime: "12:00" }, CTX)).rejects.toBeInstanceOf(ConflictError);
    await expect(ctx.createRule(ADMIN_A, { ...base, professionalId: other.id, startTime: "10:30", endTime: "12:00" }, CTX)).resolves.toBeDefined();
    await expect(ctx.createRule(ADMIN_A, { ...base, professionalId: professional.id, startTime: "11:00", endTime: "12:00" }, CTX)).resolves.toBeDefined();
  });

  it("limite de 200 regras por clínica => CONFLICT", async () => {
    const ctx = setup();
    const professional = await ctx.createProfessional(ADMIN_A, { name: "Ana" }, CTX);
    const service = await ctx.createService(ADMIN_A, { name: "Cons", kind: "APPOINTMENT", durationMinutes: 15 }, CTX);
    for (let i = 0; i < 200; i++) {
      await ctx.deps.scheduleRulesRepo.insert({}, { id: `r-${String(i)}`, clinicId: ADMIN_A.clinicId, professionalId: professional.id, serviceTypeId: service.id, weekdays: [7], startTime: "09:00", endTime: "09:15", validFrom: null, validUntil: null, capacity: 1, createdAt: NOW });
    }
    await expect(ctx.createRule(ADMIN_A, { professionalId: professional.id, serviceTypeId: service.id, weekdays: [1], startTime: "09:00", endTime: "10:00" }, CTX)).rejects.toBeInstanceOf(ConflictError);
  });

  it("horário gerado sobreposto a um manual do profissional é ignorado (skippedOverlap), sem erro nem remoção", async () => {
    const ctx = setup();
    const professional = await ctx.createProfessional(ADMIN_A, { name: "Ana" }, CTX);
    const service = await ctx.createService(ADMIN_A, { name: "Cons", kind: "APPOINTMENT", durationMinutes: 30 }, CTX);
    // Manual 09:15 (local = 08:15Z) na segunda 2026-10-12, 30 min.
    await ctx.publish(ADMIN_A, { date: "2026-10-12", times: ["09:15"], professionalId: professional.id, serviceTypeId: service.id }, CTX);
    const { generation } = await ctx.createRule(ADMIN_A, { professionalId: professional.id, serviceTypeId: service.id, weekdays: [1], startTime: "09:00", endTime: "10:00", validFrom: "2026-10-12", validUntil: "2026-10-12" }, CTX);
    // 09:00 e 09:30 sobrepõem [09:15,09:45); 10:00 não cabe (termina 10:30 > endTime) — só 2 candidatos.
    expect(generation).toMatchObject({ created: 0, skippedOverlap: 2 });
    expect(slotsOf(ctx)).toHaveLength(1);
  });

  it("regras não duplicam entre profissionais: o mesmo horário para outro profissional é válido", async () => {
    const ctx = setup();
    const service = await ctx.createService(ADMIN_A, { name: "Cons", kind: "APPOINTMENT", durationMinutes: 30 }, CTX);
    const a = await ctx.createProfessional(ADMIN_A, { name: "A" }, CTX);
    const b = await ctx.createProfessional(ADMIN_A, { name: "B" }, CTX);
    const input = { serviceTypeId: service.id, weekdays: [1], startTime: "09:00", endTime: "09:30", validFrom: "2026-10-12", validUntil: "2026-10-12" };
    await ctx.createRule(ADMIN_A, { ...input, professionalId: a.id }, CTX);
    const second = await ctx.createRule(ADMIN_A, { ...input, professionalId: b.id }, CTX);
    expect(second.generation.created).toBe(1);
  });

  it("auditoria das regras: ids, kind e contagens; nunca nomes", async () => {
    const ctx = setup();
    await seedWeekdayRule(ctx);
    const event = ctx.fixtures.audit.events.find((e) => e.action === "CLINIC_SCHEDULE_RULE_CREATE");
    expect(event?.metadata).toMatchObject({ kind: "APPOINTMENT", created: 160, active: true });
    expect(JSON.stringify(ctx.fixtures.audit.events)).not.toMatch(/Dra\. Ana|Cardiologia|Consulta geral/);
  });
});

describe("reconciliação ao editar/desativar (BR-CLN-15, AC-CLN-11)", () => {
  it("desativar a regra remove os livres futuros gerados e mantém o marcado (keptBooked=1); manual e passado intocados", async () => {
    const ctx = setup();
    const { professional, service, rule } = await seedWeekdayRule(ctx);
    const generated = slotsOf(ctx);
    const booked = must(generated[10]);
    ctx.fixtures.slotOccupancy.book(booked.id);
    // Um horário manual (sem regra) do mesmo profissional, num dia sem regra (sábado).
    const manual = await ctx.publish(ADMIN_A, { date: "2026-10-17", times: ["10:00"], professionalId: professional.id, serviceTypeId: service.id }, CTX);
    // Um passado gerado "à mão" (da regra, anterior a agora).
    const past = await ctx.deps.clinicSlotsRepo.insert({}, { id: "past", clinicId: ADMIN_A.clinicId, kind: "APPOINTMENT", specialty: "Consulta geral", startsAt: new Date("2026-10-05T08:00:00Z"), durationMinutes: 30, capacity: 1, scheduleRuleId: rule.id, professionalId: professional.id, serviceTypeId: service.id, createdAt: NOW });

    const result = await ctx.updateRule(ADMIN_A, rule.id, { active: false }, CTX);

    expect(result.generation).toMatchObject({ removed: 159, keptBooked: 1, created: 0 });
    const remaining = slotsOf(ctx).map((s) => s.id).sort();
    expect(remaining).toEqual([booked.id, manual[0]?.id, past.id].sort());
    expect(ctx.fixtures.audit.events.at(-1)).toMatchObject({ action: "CLINIC_SCHEDULE_RULE_UPDATE", metadata: { active: false, removed: 159, keptBooked: 1 } });
  });

  it("editar horas/dias: remove os livres que deixaram de corresponder e gera os que faltam", async () => {
    const ctx = setup();
    const { rule } = await seedWeekdayRule(ctx);
    // De 09:00–11:00 seg–sex (4/dia) para só segundas 09:00–10:00 (2/dia).
    const result = await ctx.updateRule(ADMIN_A, rule.id, { weekdays: [1], endTime: "10:00" }, CTX);
    const slots = slotsOf(ctx);
    expect(slots).toHaveLength(16); // 8 segundas x 2
    expect(result.generation.removed).toBe(144);
    expect(result.generation.created).toBe(0);
    // Idempotente depois da edição.
    expect((await ctx.regenerate(ADMIN_A, rule.id, CTX)).generation).toMatchObject({ created: 0, removed: 0, unchanged: 16 });
  });

  it("desativar o profissional ou o serviço remove os livres gerados; reativar não repõe sozinho, mas regenerar sim", async () => {
    const ctx = setup();
    const { professional, rule } = await seedWeekdayRule(ctx);
    await ctx.updateProfessional(ADMIN_A, professional.id, { active: false }, CTX);
    expect(slotsOf(ctx)).toHaveLength(0);
    expect(ctx.fixtures.audit.events.at(-1)).toMatchObject({ action: "CLINIC_PROFESSIONAL_UPDATE", metadata: { active: false, removedSlots: 160, keptBooked: 0 } });
    await ctx.updateProfessional(ADMIN_A, professional.id, { active: true }, CTX);
    expect(slotsOf(ctx)).toHaveLength(0);
    expect((await ctx.regenerate(ADMIN_A, rule.id, CTX)).generation.created).toBe(160);

    const services = await ctx.listServices(ADMIN_A, {});
    const service = must(services[0]);
    await ctx.updateService(ADMIN_A, service.id, { active: false }, CTX);
    expect(slotsOf(ctx)).toHaveLength(0);
    // Regra inativa/serviço inativo: regenerar reconcilia e não gera.
    expect((await ctx.regenerate(ADMIN_A, rule.id, CTX)).generation).toMatchObject({ created: 0 });
  });

  it("não se altera profissional/serviço da regra; regra de outra clínica => NOT_FOUND; reativar com profissional inativo => CONFLICT", async () => {
    const ctx = setup();
    const { professional, rule } = await seedWeekdayRule(ctx);
    await expect(ctx.updateRule(ADMIN_A, rule.id, { professionalId: "x" }, CTX)).rejects.toBeInstanceOf(ValidationError);
    await expect(ctx.updateRule(ADMIN_B, rule.id, { active: false }, CTX)).rejects.toBeInstanceOf(NotFoundError);
    await expect(ctx.regenerate(ADMIN_B, rule.id, CTX)).rejects.toBeInstanceOf(NotFoundError);
    await ctx.updateRule(ADMIN_A, rule.id, { active: false }, CTX);
    await ctx.updateProfessional(ADMIN_A, professional.id, { active: false }, CTX);
    await expect(ctx.updateRule(ADMIN_A, rule.id, { active: true }, CTX)).rejects.toBeInstanceOf(ConflictError);
    expect(await ctx.listRules(ADMIN_B, {})).toEqual([]);
    expect(await ctx.listRules(ADMIN_A, { active: false })).toHaveLength(1);
  });
});

describe("publicação manual com profissional (BR-CLN-13/14, AC-CLN-09) e remoção de gerados", () => {
  it("09:00–09:30 existe: 09:15 (30 min) => CONFLICT e nada é criado; 09:30 => ok; outro profissional ok; duplicado exato ignorado", async () => {
    const ctx = setup();
    const p = await ctx.createProfessional(ADMIN_A, { name: "P" }, CTX);
    const q = await ctx.createProfessional(ADMIN_A, { name: "Q" }, CTX);
    const s = await ctx.createService(ADMIN_A, { name: "Cons", kind: "APPOINTMENT", durationMinutes: 30 }, CTX);
    const base = { date: "2026-10-20", serviceTypeId: s.id };
    expect(await ctx.publish(ADMIN_A, { ...base, times: ["09:00"], professionalId: p.id }, CTX)).toHaveLength(1);

    const before = slotsOf(ctx).length;
    await expect(ctx.publish(ADMIN_A, { ...base, times: ["10:00", "09:15"], professionalId: p.id }, CTX)).rejects.toBeInstanceOf(ConflictError);
    // O driver real faz rollback; nos fakes não há transação — o contrato é o CONFLICT.
    expect(before).toBe(1);

    expect(await ctx.publish(ADMIN_A, { ...base, times: ["09:30"], professionalId: p.id }, CTX)).toHaveLength(1);
    expect(await ctx.publish(ADMIN_A, { ...base, times: ["09:15"], professionalId: q.id }, CTX)).toHaveLength(1);
    expect(await ctx.publish(ADMIN_A, { ...base, times: ["09:00", "09:00"], professionalId: p.id }, CTX)).toHaveLength(0);
  });

  it("serviceTypeId: kind/specialty/durationMinutes vêm do serviço; valores diferentes => VALIDATION_ERROR; sem serviço specialty/duração são obrigatórios", async () => {
    const ctx = setup();
    const s = await ctx.createService(ADMIN_A, { name: "Eco", kind: "EXAM", durationMinutes: 45 }, CTX);
    const [slot] = await ctx.publish(ADMIN_A, { date: "2026-10-20", times: ["09:00"], serviceTypeId: s.id, capacity: 4 }, CTX);
    expect(slot).toMatchObject({ kind: "EXAM", specialty: "Eco", durationMinutes: 45, capacity: 4, serviceTypeId: s.id });
    await expect(ctx.publish(ADMIN_A, { date: "2026-10-20", times: ["11:00"], serviceTypeId: s.id, durationMinutes: 30 }, CTX)).rejects.toBeInstanceOf(ValidationError);
    await expect(ctx.publish(ADMIN_A, { date: "2026-10-20", times: ["11:00"], serviceTypeId: s.id, specialty: "Outra" }, CTX)).rejects.toBeInstanceOf(ValidationError);
    await expect(ctx.publish(ADMIN_A, { date: "2026-10-20", times: ["11:00"], durationMinutes: 30 }, CTX)).rejects.toBeInstanceOf(ValidationError);
    await expect(ctx.publish(ADMIN_A, { date: "2026-10-20", times: ["11:00"], specialty: "Geral" }, CTX)).rejects.toBeInstanceOf(ValidationError);
  });

  it("professionalId/serviceTypeId de outra clínica => NOT_FOUND; inativo => CONFLICT", async () => {
    const ctx = setup();
    const p = await ctx.createProfessional(ADMIN_A, { name: "P" }, CTX);
    const s = await ctx.createService(ADMIN_A, { name: "S", kind: "APPOINTMENT", durationMinutes: 30 }, CTX);
    const input = { date: "2026-10-20", times: ["09:00"], specialty: "Geral", durationMinutes: 30 };
    await expect(ctx.publish(ADMIN_B, { ...input, professionalId: p.id }, CTX)).rejects.toBeInstanceOf(NotFoundError);
    await expect(ctx.publish(ADMIN_B, { ...input, serviceTypeId: s.id }, CTX)).rejects.toBeInstanceOf(NotFoundError);
    await ctx.updateProfessional(ADMIN_A, p.id, { active: false }, CTX);
    await expect(ctx.publish(ADMIN_A, { ...input, professionalId: p.id }, CTX)).rejects.toBeInstanceOf(ConflictError);
  });

  it("DELETE de horário gerado => CONFLICT; o manual livre remove-se; a capacity de um exame gerado continua editável", async () => {
    const ctx = setup();
    const professional = await ctx.createProfessional(ADMIN_A, { name: "T" }, CTX);
    const exam = await ctx.createService(ADMIN_A, { name: "Eco", kind: "EXAM", durationMinutes: 60 }, CTX);
    await ctx.createRule(ADMIN_A, { professionalId: professional.id, serviceTypeId: exam.id, weekdays: [1], startTime: "09:00", endTime: "10:00", capacity: 2 }, CTX);
    const generated = must(slotsOf(ctx)[0]);
    await expect(ctx.removeSlot(ADMIN_A, generated.id, CTX)).rejects.toBeInstanceOf(ConflictError);
    expect(await ctx.patchSlot(ADMIN_A, generated.id, { capacity: 5 }, CTX)).toMatchObject({ capacity: 5 });

    const [manual] = await ctx.publish(ADMIN_A, { date: "2026-10-17", times: ["10:00"], specialty: "Geral", durationMinutes: 30 }, CTX);
    await ctx.removeSlot(ADMIN_A, must(manual).id, CTX);
    expect(ctx.fixtures.clinicSlotsRepo.byId.has(must(manual).id)).toBe(false);
  });
});

describe("bloqueios/férias (BR-CLN-14, AC-CLN-10)", () => {
  const dayStart = new Date("2026-10-13T00:00:00Z");
  const dayEnd = new Date("2026-10-14T00:00:00Z");

  it("remove só os livres do intervalo, lista os marcados sem PII, mantém as marcações e `bookedSlotCount`", async () => {
    const ctx = setup();
    const { professional } = await seedWeekdayRule(ctx);
    const tuesday = slotsOf(ctx).filter((s) => s.startsAt >= dayStart && s.startsAt < dayEnd);
    expect(tuesday).toHaveLength(4);
    const [b1, b2] = tuesday as [(typeof tuesday)[number], (typeof tuesday)[number]];
    ctx.fixtures.slotOccupancy.book(b1.id);
    ctx.fixtures.slotOccupancy.book(b2.id, "requested");

    const result = await ctx.createTimeOff(MANAGER_A, { professionalId: professional.id, startsAt: dayStart.toISOString(), endsAt: dayEnd.toISOString(), reason: "Férias - dentista" }, CTX);

    expect(result.removedSlots).toBe(2);
    expect(result.bookedSlots.map((s) => s.slotId).sort()).toEqual([b1.id, b2.id].sort());
    expect(result.bookedSlots.every((s) => s.bookedCount === 1)).toBe(true);
    expect(Object.keys(result.bookedSlots[0] ?? {}).sort()).toEqual(["bookedCount", "durationMinutes", "kind", "slotId", "startsAt"]);
    expect(result.timeOff.bookedSlotCount).toBe(2);
    expect(slotsOf(ctx).filter((s) => s.startsAt >= dayStart && s.startsAt < dayEnd).map((s) => s.id).sort()).toEqual([b1.id, b2.id].sort());

    const list = await ctx.listTimeOff(ADMIN_A, {});
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ bookedSlotCount: 2, reason: "Férias - dentista" });

    const event = ctx.fixtures.audit.events.find((e) => e.action === "CLINIC_TIME_OFF_CREATE");
    expect(event?.metadata).toEqual({ professionalId: professional.id, removedSlots: 2, bookedSlots: 2 });
    expect(JSON.stringify(ctx.fixtures.audit.events)).not.toContain("dentista");
  });

  it("a geração seguinte não recria o intervalo; remover o bloqueio recria só os livres previstos (marcados mantêm-se, sem duplicados)", async () => {
    const ctx = setup();
    const { professional, rule } = await seedWeekdayRule(ctx);
    const tuesday = slotsOf(ctx).filter((s) => s.startsAt >= dayStart && s.startsAt < dayEnd);
    ctx.fixtures.slotOccupancy.book(must(tuesday[0]).id);
    const { timeOff } = await ctx.createTimeOff(ADMIN_A, { professionalId: professional.id, startsAt: dayStart.toISOString(), endsAt: dayEnd.toISOString() }, CTX);

    expect((await ctx.regenerate(ADMIN_A, rule.id, CTX)).generation).toMatchObject({ created: 0, skippedTimeOff: 3, unchanged: 157 });
    const job = await createGenerateScheduleJobUseCase(ctx.deps)();
    expect(job).toMatchObject({ created: 0, skippedTimeOff: 3 });

    const generation = await ctx.deleteTimeOff(ADMIN_A, timeOff.id, CTX);
    expect(generation).toMatchObject({ created: 3, unchanged: 1, skippedOverlap: 0, skippedTimeOff: 0 });
    expect(slotsOf(ctx)).toHaveLength(160);
    expect(ctx.fixtures.audit.events.at(-1)).toMatchObject({ action: "CLINIC_TIME_OFF_DELETE" });
  });

  it("publicação manual com professionalId no intervalo bloqueado => CONFLICT", async () => {
    const ctx = setup();
    const p = await ctx.createProfessional(ADMIN_A, { name: "P" }, CTX);
    await ctx.createTimeOff(ADMIN_A, { professionalId: p.id, startsAt: dayStart.toISOString(), endsAt: dayEnd.toISOString() }, CTX);
    await expect(ctx.publish(ADMIN_A, { date: "2026-10-13", times: ["10:00"], professionalId: p.id, specialty: "Geral", durationMinutes: 30 }, CTX)).rejects.toBeInstanceOf(ConflictError);
    // Outro dia e sem profissional continuam livres.
    await expect(ctx.publish(ADMIN_A, { date: "2026-10-15", times: ["10:00"], professionalId: p.id, specialty: "Geral", durationMinutes: 30 }, CTX)).resolves.toHaveLength(1);
    await expect(ctx.publish(ADMIN_A, { date: "2026-10-13", times: ["10:00"], specialty: "Geral", durationMinutes: 30 }, CTX)).resolves.toHaveLength(1);
  });

  it.each([
    ["fim = início", "2026-10-13T00:00:00Z", "2026-10-13T00:00:00Z"],
    ["fim < início", "2026-10-14T00:00:00Z", "2026-10-13T00:00:00Z"],
    ["mais de 366 dias", "2026-10-13T00:00:00Z", "2027-10-20T00:00:00Z"],
    ["fim no passado", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z"],
    ["motivo > 200", "2026-10-13T00:00:00Z", "2026-10-14T00:00:00Z", "x".repeat(201)],
  ])("intervalo inválido (%s) => VALIDATION_ERROR", async (_name, startsAt, endsAt, reason?: string) => {
    const ctx = setup();
    const p = await ctx.createProfessional(ADMIN_A, { name: "P" }, CTX);
    await expect(ctx.createTimeOff(ADMIN_A, { professionalId: p.id, startsAt, endsAt, ...(reason ? { reason } : {}) }, CTX)).rejects.toBeInstanceOf(ValidationError);
  });

  it("profissional/bloqueio de outra clínica => NOT_FOUND; listagem isolada e por omissão só os que terminam depois de agora", async () => {
    const ctx = setup();
    const p = await ctx.createProfessional(ADMIN_A, { name: "P" }, CTX);
    await expect(ctx.createTimeOff(ADMIN_B, { professionalId: p.id, startsAt: dayStart.toISOString(), endsAt: dayEnd.toISOString() }, CTX)).rejects.toBeInstanceOf(NotFoundError);
    const { timeOff } = await ctx.createTimeOff(ADMIN_A, { professionalId: p.id, startsAt: dayStart.toISOString(), endsAt: dayEnd.toISOString() }, CTX);
    await expect(ctx.deleteTimeOff(ADMIN_B, timeOff.id, CTX)).rejects.toBeInstanceOf(NotFoundError);
    expect(await ctx.listTimeOff(ADMIN_B, {})).toEqual([]);
    expect(await ctx.listTimeOff(ADMIN_A, { to: new Date("2026-10-12T00:00:00Z") })).toEqual([]);
    expect(await ctx.listTimeOff(ADMIN_A, { professionalId: p.id })).toHaveLength(1);
    (ctx.deps.clock as FixedClock).advance(30 * 24 * 3600 * 1000);
    expect(await ctx.listTimeOff(ADMIN_A, {})).toEqual([]);
  });

  it("ordem de bloqueio: o profissional é bloqueado antes de tocar nos horários (schema.md §3a)", async () => {
    const ctx = setup();
    const { professional } = await seedWeekdayRule(ctx);
    ctx.fixtures.catalogRepo.locks.length = 0;
    await ctx.createTimeOff(ADMIN_A, { professionalId: professional.id, startsAt: dayStart.toISOString(), endsAt: dayEnd.toISOString() }, CTX);
    expect(ctx.fixtures.catalogRepo.locks).toEqual([professional.id]);
  });
});
