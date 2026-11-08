// AC-CLN-13 / TC-CLN-08 (A): CRUD sem DELETE, validações, pesquisa, paginação por cursor, rate limit e auditoria sem PII.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { NotFoundError, RateLimitedError, ValidationError } from "../../../platform/errors/index.js";
import { createClinicPatientsFixtures } from "./fixtures.js";
import { createCreateClinicPatientUseCase, createGetClinicPatientUseCase, createListClinicPatientsUseCase, createUpdateClinicPatientUseCase } from "./patients.js";

const NOW = new Date("2026-11-08T10:00:00.000Z");
const A = { clinicAccountId: "acc-a", clinicId: "clinic-a" };
const B = { clinicAccountId: "acc-b", clinicId: "clinic-b" };
const CTX = { requestId: "req-1", ip: "10.0.0.1" };

function setup() {
  const clock = new FixedClock(NOW);
  const fx = createClinicPatientsFixtures(clock);
  return {
    clock,
    fx,
    create: createCreateClinicPatientUseCase(fx.deps),
    update: createUpdateClinicPatientUseCase(fx.deps),
    get: createGetClinicPatientUseCase(fx.deps),
    list: createListClinicPatientsUseCase(fx.deps),
  };
}

describe("createClinicPatient", () => {
  it("nasce MANUAL sem ligação Vita; resposta sem ids Vita; auditoria só com `origin` (canário sem PII)", async () => {
    const { fx, create } = setup();
    const view = await create(A, { name: "CANARY-NOME Silva", phone: "+351 911 111 111", email: "CANARY@x.pt", birthDate: "1980-01-01", notes: "CANARY-NOTA" }, CTX);
    expect(view).toMatchObject({ name: "CANARY-NOME Silva", origin: "MANUAL", vitaLink: null, email: "canary@x.pt" });
    expect(Object.keys(view).sort()).toEqual(["birthDate", "createdAt", "email", "id", "name", "notes", "origin", "phone", "updatedAt", "vitaLink"]);
    expect(fx.audit.events).toHaveLength(1);
    expect(fx.audit.events[0]).toMatchObject({ action: "CLINIC_PATIENT_CREATE", actorType: "CLINIC_ACCOUNT", actorClinicAccountId: "acc-a", resourceType: "ClinicPatient", resourceId: view.id, metadata: { origin: "MANUAL" } });
    expect(fx.audit.events[0]?.familyId).toBeUndefined();
    const dump = JSON.stringify(fx.audit.events).toLowerCase();
    for (const canary of ["canary", "911", "1980"]) expect(dump).not.toContain(canary);
  });

  it("homónimos são válidos (sem unicidade por nome)", async () => {
    const { create } = setup();
    const one = await create(A, { name: "Ana Silva" }, CTX);
    const two = await create(A, { name: "Ana Silva" }, CTX);
    expect(one.id).not.toBe(two.id);
  });

  it("validação: nome vazio e data de nascimento futura => VALIDATION_ERROR", async () => {
    const { create } = setup();
    await expect(create(A, { name: "" }, CTX)).rejects.toBeInstanceOf(ValidationError);
    await expect(create(A, { name: "A", birthDate: "2026-11-09" }, CTX)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("get / update (isolamento por clínica)", () => {
  it("outra clínica => NOT_FOUND (get e update); a ficha não muda", async () => {
    const { fx, create, get, update } = setup();
    const patient = await create(A, { name: "Ana" }, CTX);
    await expect(get(B, patient.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(update(B, patient.id, { name: "Hack" }, CTX)).rejects.toBeInstanceOf(NotFoundError);
    expect((await get(A, patient.id)).name).toBe("Ana");
    expect(fx.audit.events).toHaveLength(1);
  });

  it("PATCH: null limpa opcionais; origin e vitaLink não se editam; auditoria só com NOMES dos campos", async () => {
    const { fx, clock, create, update } = setup();
    const patient = await create(A, { name: "Ana", phone: "+351 911 111 111", notes: "nota" }, CTX);
    clock.advance(1000);
    const updated = await update(A, patient.id, { phone: null, name: "CANARY-NOVO", notes: "CANARY-SEGREDO" }, CTX);
    expect(updated).toMatchObject({ name: "CANARY-NOVO", phone: null, notes: "CANARY-SEGREDO", origin: "MANUAL" });
    expect(updated.updatedAt > updated.createdAt).toBe(true);
    const event = fx.audit.events.at(-1);
    expect(event).toMatchObject({ action: "CLINIC_PATIENT_UPDATE", metadata: { origin: "MANUAL", fields: "name,notes,phone" } });
    expect(JSON.stringify(event).toLowerCase()).not.toContain("canary");
  });
});

describe("listClinicPatients (pesquisa e cursor)", () => {
  async function seed() {
    const s = setup();
    for (const name of ["Ângela Costa", "Bruno Dias", "Carla Dias", "Daniel Évora", "Eva Costa"]) {
      await s.create(A, { name, phone: name.startsWith("B") ? "+351 912 345 678" : undefined, email: name.startsWith("C") ? "carla@mail.pt" : undefined }, CTX);
    }
    await s.create(B, { name: "Ângela Outra Clínica" }, CTX);
    return s;
  }

  it("lista só a clínica do ator, por nome; q sem acentos/maiúsculas; e-mail e telefone", async () => {
    const { list } = await seed();
    expect((await list(A, {})).items.map((p) => p.name)).toEqual(["Ângela Costa", "Bruno Dias", "Carla Dias", "Daniel Évora", "Eva Costa"]);
    expect((await list(A, { q: "angela" })).items.map((p) => p.name)).toEqual(["Ângela Costa"]);
    expect((await list(A, { q: "COSTA" })).items.map((p) => p.name)).toEqual(["Ângela Costa", "Eva Costa"]);
    expect((await list(A, { q: "carla@mail" })).items.map((p) => p.name)).toEqual(["Carla Dias"]);
    expect((await list(A, { q: "912 345" })).items.map((p) => p.name)).toEqual(["Bruno Dias"]);
    expect((await list(A, { q: "%%" })).items).toEqual([]);
  });

  it("paginação por cursor estável, sem repetições nem saltos", async () => {
    const { list } = await seed();
    const first = await list(A, { limit: 2 });
    expect(first.items.map((p) => p.name)).toEqual(["Ângela Costa", "Bruno Dias"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await list(A, { limit: 2, cursor: (first.nextCursor ?? "") });
    expect(second.items.map((p) => p.name)).toEqual(["Carla Dias", "Daniel Évora"]);
    const third = await list(A, { limit: 2, cursor: (second.nextCursor ?? "") });
    expect(third.items.map((p) => p.name)).toEqual(["Eva Costa"]);
    expect(third.nextCursor).toBeNull();
  });

  it("q curto/longo e cursor inválido => VALIDATION_ERROR", async () => {
    const { list } = setup();
    await expect(list(A, { q: "a" })).rejects.toBeInstanceOf(ValidationError);
    await expect(list(A, { q: "x".repeat(101) })).rejects.toBeInstanceOf(ValidationError);
    await expect(list(A, { cursor: "lixo" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("60 pedidos/min por conta; o 61.º => RATE_LIMITED com Retry-After; outra conta não é afetada; não se audita", async () => {
    const { fx, clock, list } = setup();
    for (let i = 0; i < 60; i++) await list(A, {});
    await expect(list(A, { q: "ab" })).rejects.toBeInstanceOf(RateLimitedError);
    await expect(list(B, {})).resolves.toBeDefined();
    clock.advance(60_001);
    await expect(list(A, {})).resolves.toBeDefined();
    expect(fx.audit.events).toEqual([]);
  });
});
