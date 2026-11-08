// AC-CLN-15/16 / TC-CLN-10/11 (S/A): código de ligação (uso único, expiração, 404 idêntico, conflitos, rate limits) e
// consentimento por clínica (níveis, expiração, revogação, autorização SELF/TUTOR_OF).
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { ConflictError, ForbiddenError, NotFoundError, RateLimitedError, ValidationError } from "../../../platform/errors/index.js";
import { LINK_CODE_TTL_MS, hashLinkCode } from "../domain/link-code.js";
import {
  createCreateClinicLinkCodeUseCase,
  createListClinicConsentsUseCase,
  createPutClinicConsentUseCase,
  createRevokeClinicConsentUseCase,
} from "./consents.js";
import { TEST_LINK_CODE_SECRET, createClinicPatientsFixtures } from "./fixtures.js";
import { createLinkClinicPatientUseCase } from "./patient-link.js";
import { createCreateClinicPatientUseCase } from "./patients.js";
import { createGetSharedHistoryUseCase } from "./shared-history.js";

const NOW = new Date("2026-11-08T10:00:00.000Z");
const CLINIC = "clinic-a";
const OTHER_CLINIC = "clinic-b";
const ACTOR = { clinicAccountId: "acc-a", clinicId: CLINIC };
const OTHER_ACTOR = { clinicAccountId: "acc-b", clinicId: OTHER_CLINIC };
const FAMILY = "fam-1";
const MEMBER = "mem-1";
const DEPENDENT = "mem-dep";
const OWNER = { userId: "user-1", platformAdmin: false };
const CTX = { requestId: "req-1", ip: "10.0.0.1" };

function setup() {
  const clock = new FixedClock(NOW);
  const fx = createClinicPatientsFixtures(clock);
  fx.members.names.set(MEMBER, "CANARY Maria Santos Silva");
  fx.members.names.set(DEPENDENT, "Joãozinho Pequeno");
  fx.clinics.clinics.set(CLINIC, { id: CLINIC, name: "Clínica Sol", active: true });
  fx.clinics.clinics.set("clinic-arch", { id: "clinic-arch", name: "Arquivada", active: false });
  fx.policy.relations.set(`user-1:${MEMBER}`, "SELF");
  fx.policy.relations.set(`user-1:${DEPENDENT}`, "TUTOR_OF");
  fx.policy.relations.set(`user-2:${MEMBER}`, "OTHER");
  fx.policy.relations.set(`user-dep:${DEPENDENT}`, "DEPENDENT_SELF");
  return {
    clock,
    fx,
    gen: createCreateClinicLinkCodeUseCase(fx.deps),
    link: createLinkClinicPatientUseCase(fx.deps),
    create: createCreateClinicPatientUseCase(fx.deps),
    put: createPutClinicConsentUseCase(fx.deps),
    revoke: createRevokeClinicConsentUseCase(fx.deps),
    list: createListClinicConsentsUseCase(fx.deps),
    history: createGetSharedHistoryUseCase(fx.deps),
  };
}

describe("createClinicLinkCode (BR-CLN-20)", () => {
  it("devolve 8 caracteres e +10 min; guarda só o HMAC; auditoria USER sem o código", async () => {
    const { fx, gen } = setup();
    const { code, expiresAt } = await gen(OWNER, FAMILY, MEMBER, CTX);
    expect(code).toMatch(/^[A-HJ-KM-NP-Z2-9]{8}$/);
    expect(new Date(expiresAt).getTime()).toBe(NOW.getTime() + LINK_CODE_TTL_MS);
    expect(fx.codesRepo.codes).toHaveLength(1);
    expect(fx.codesRepo.codes[0]?.codeHash).toBe(hashLinkCode(TEST_LINK_CODE_SECRET, code));
    expect(JSON.stringify(fx.codesRepo.codes)).not.toContain(code);
    expect(fx.audit.events).toEqual([expect.objectContaining({ action: "CLINIC_LINK_CODE_CREATE", actorType: "USER", actorUserId: "user-1", familyId: FAMILY, subjectMemberId: MEMBER })]);
    expect(JSON.stringify(fx.audit.events)).not.toContain(code);
  });

  it("gerar outro invalida o anterior (o antigo passa a 404)", async () => {
    const { gen, link } = setup();
    const first = await gen(OWNER, FAMILY, MEMBER, CTX);
    const second = await gen(OWNER, FAMILY, MEMBER, CTX);
    await expect(link(ACTOR, { code: first.code }, CTX)).rejects.toBeInstanceOf(NotFoundError);
    await expect(link(ACTOR, { code: second.code }, CTX)).resolves.toBeDefined();
  });

  it("5 códigos/hora por membro: o 6.º => RATE_LIMITED; passada a hora volta a permitir", async () => {
    const { clock, gen } = setup();
    for (let i = 0; i < 5; i++) await gen(OWNER, FAMILY, MEMBER, CTX);
    const error = await gen(OWNER, FAMILY, MEMBER, CTX).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterMs).toBe(3_600_000);
    clock.advance(3_600_001);
    await expect(gen(OWNER, FAMILY, MEMBER, CTX)).resolves.toBeDefined();
  });

  it("autorização: tutor gera para o dependente; DEPENDENT_SELF/OTHER => FORBIDDEN; desconhecido => NOT_FOUND", async () => {
    const { gen } = setup();
    await expect(gen(OWNER, FAMILY, DEPENDENT, CTX)).resolves.toBeDefined();
    await expect(gen({ userId: "user-dep", platformAdmin: false }, FAMILY, DEPENDENT, CTX)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(gen({ userId: "user-2", platformAdmin: false }, FAMILY, MEMBER, CTX)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(gen({ userId: "estranho", platformAdmin: false }, FAMILY, MEMBER, CTX)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("linkClinicPatient (BR-CLN-20/19)", () => {
  it("sem clinicPatientId cria paciente VITA com displayName, link CODE e consentimento BOOKINGS; código consumido; auditoria sem o código", async () => {
    const { fx, gen, link } = setup();
    const { code } = await gen(OWNER, FAMILY, MEMBER, CTX);
    const view = await link(ACTOR, { code: code.slice(0, 4) + "-" + code.slice(4).toLowerCase() }, CTX);
    expect(view).toMatchObject({ name: "CANARY S.", origin: "VITA", vitaLink: { via: "CODE", consentLevel: "BOOKINGS", consentValidUntil: null } });
    expect(JSON.stringify(view)).not.toContain(FAMILY);
    expect(JSON.stringify(view)).not.toContain(MEMBER);
    expect(fx.consentsRepo.consents).toEqual([{ clinicId: CLINIC, familyId: FAMILY, memberId: MEMBER, level: "BOOKINGS" }]);
    const event = fx.audit.events.at(-1);
    expect(event).toMatchObject({ action: "CLINIC_PATIENT_LINK", result: "SUCCESS", resourceId: view.id, familyId: FAMILY, subjectMemberId: MEMBER, metadata: { via: "CODE", created: true } });
    expect(JSON.stringify(fx.audit.events)).not.toContain(code);
    // uso único
    await expect(link(ACTOR, { code }, CTX)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("com clinicPatientId liga um paciente existente sem ligação; não baixa um HISTORY existente", async () => {
    const { fx, gen, link, create, put } = setup();
    await put(OWNER, FAMILY, MEMBER, CLINIC, { level: "HISTORY" }, CTX);
    const patient = await create(ACTOR, { name: "Maria Balcão" }, CTX);
    const { code } = await gen(OWNER, FAMILY, MEMBER, CTX);
    const view = await link(ACTOR, { code, clinicPatientId: patient.id }, CTX);
    expect(view).toMatchObject({ id: patient.id, name: "Maria Balcão", origin: "MANUAL", vitaLink: { via: "CODE", consentLevel: "HISTORY" } });
    expect(fx.consentsRepo.consents[0]?.level).toBe("HISTORY");
    expect(fx.audit.events.at(-1)).toMatchObject({ metadata: { via: "CODE", created: false } });
  });

  it("404 idêntico: inexistente, expirado, usado e paciente de outra clínica — e nada é consumido nos dois últimos casos de erro de paciente", async () => {
    const { clock, fx, gen, link, create } = setup();
    const expired = await gen(OWNER, FAMILY, MEMBER, CTX);
    clock.advance(LINK_CODE_TTL_MS);
    const fresh = await gen(OWNER, FAMILY, MEMBER, CTX);
    const foreignPatient = await create(OTHER_ACTOR, { name: "Alheio" }, CTX);
    const errors = [];
    for (const input of [{ code: "ABCDEFGH" }, { code: expired.code }, { code: fresh.code, clinicPatientId: foreignPatient.id }, { code: fresh.code, clinicPatientId: "00000000-0000-4000-8000-000000000000" }]) {
      errors.push(await link(ACTOR, input, CTX).catch((e: unknown) => e));
    }
    for (const e of errors) expect(e).toBeInstanceOf(NotFoundError);
    expect(new Set(errors.map((e) => JSON.stringify({ code: (e as NotFoundError).code, detail: (e as NotFoundError).detail }))).size).toBe(1);
    // o código válido continua utilizável (o erro de paciente não o consome)
    await expect(link(ACTOR, { code: fresh.code }, CTX)).resolves.toBeDefined();
    // falhas auditadas sem sujeito
    const failures = fx.audit.events.filter((e) => e.result === "FAILURE");
    expect(failures).toHaveLength(4);
    for (const f of failures) {
      expect(f).toMatchObject({ action: "CLINIC_PATIENT_LINK", actorType: "CLINIC_ACCOUNT" });
      expect(f.familyId).toBeUndefined();
      expect(f.subjectMemberId).toBeUndefined();
    }
  });

  it("formato inválido => VALIDATION_ERROR (sem ecoar o valor)", async () => {
    const { link } = setup();
    await expect(link(ACTOR, { code: "curto" }, CTX)).rejects.toBeInstanceOf(ValidationError);
  });

  it("CONFLICT: paciente já ligado a outra pessoa; membro já ligado a outro paciente da clínica; mesmo paciente => idempotente", async () => {
    const { fx, gen, link, create } = setup();
    const first = await link(ACTOR, (await gen(OWNER, FAMILY, MEMBER, CTX)), CTX);
    // membro (MEMBER) já ligado a `first`: indicar outro paciente => CONFLICT
    const other = await create(ACTOR, { name: "Outro" }, CTX);
    const again = await gen(OWNER, FAMILY, MEMBER, CTX);
    await expect(link(ACTOR, { code: again.code, clinicPatientId: other.id }, CTX)).rejects.toBeInstanceOf(ConflictError);
    // (a reversão do consumo do código no CONFLICT é da transação real: ver o teste de integração)
    // mesmo paciente => 200 idempotente e código consumido
    const idempotent = await gen(OWNER, FAMILY, MEMBER, CTX);
    const same = await link(ACTOR, { code: idempotent.code, clinicPatientId: first.id }, CTX);
    expect(same.id).toBe(first.id);
    expect(fx.codesRepo.codes.find((c) => c.codeHash === hashLinkCode(TEST_LINK_CODE_SECRET, idempotent.code))?.usedAt).toBeDefined();
    // sem clinicPatientId com membro já ligado => reutiliza
    const third = await link(ACTOR, await gen(OWNER, FAMILY, MEMBER, CTX), CTX);
    expect(third.id).toBe(first.id);
    // paciente já ligado a outra pessoa
    const dependentCode = await gen(OWNER, FAMILY, DEPENDENT, CTX);
    await expect(link(ACTOR, { code: dependentCode.code, clinicPatientId: first.id }, CTX)).rejects.toBeInstanceOf(ConflictError);
  });

  it("rate limit partilhado com o walk-in: 10 respostas 404/15 min e 30/h por conta => RATE_LIMITED + auditoria DENIED", async () => {
    const { fx, clock, link } = setup();
    for (let i = 0; i < 10; i++) await expect(link(ACTOR, { code: "ABCDEFGH" }, { requestId: "r", ip: `10.0.1.${String(i)}` })).rejects.toBeInstanceOf(NotFoundError);
    const blocked = await link(ACTOR, { code: "ABCDEFGH" }, CTX).catch((e: unknown) => e);
    expect(blocked).toBeInstanceOf(RateLimitedError);
    expect(fx.audit.events.at(-1)).toMatchObject({ action: "CLINIC_PATIENT_LINK", result: "DENIED", metadata: { reason: "RATE_LIMITED" } });
    // outra conta não é afetada
    await expect(link(OTHER_ACTOR, { code: "ABCDEFGH" }, CTX)).rejects.toBeInstanceOf(NotFoundError);
    clock.advance(15 * 60_000 + 1);
    await expect(link(ACTOR, { code: "ABCDEFGH" }, CTX)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("consentimento (BR-CLN-19)", () => {
  it("PUT HISTORY +12 meses; renovar; rebaixar para BOOKINGS; idempotente; auditoria sem texto", async () => {
    const { fx, clock, put } = setup();
    const granted = await put(OWNER, FAMILY, MEMBER, CLINIC, { level: "HISTORY" }, CTX);
    expect(granted).toEqual({ clinicId: CLINIC, clinicName: "Clínica Sol", level: "HISTORY", validUntil: "2027-11-08T10:00:00.000Z", renewalNeeded: false, linked: false });
    expect(fx.audit.events.at(-1)).toMatchObject({ action: "CLINIC_CONSENT_SET", actorType: "USER", metadata: { clinicId: CLINIC, level: "HISTORY", renewed: false } });
    clock.advance(30 * 86_400_000);
    const renewed = await put(OWNER, FAMILY, MEMBER, CLINIC, { level: "HISTORY" }, CTX);
    expect(renewed.validUntil).toBe("2027-12-08T10:00:00.000Z");
    expect(fx.audit.events.at(-1)).toMatchObject({ metadata: { renewed: true } });
    const down = await put(OWNER, FAMILY, MEMBER, CLINIC, { level: "BOOKINGS" }, CTX);
    expect(down).toMatchObject({ level: "BOOKINGS", validUntil: null });
    await put(OWNER, FAMILY, MEMBER, CLINIC, { level: "BOOKINGS" }, CTX);
    expect(fx.consentsRepo.consents).toHaveLength(1);
  });

  it("clínica inexistente, privada (ausente do diretório de parceiras) ou arquivada => NOT_FOUND; nível inválido => 422", async () => {
    const { put } = setup();
    await expect(put(OWNER, FAMILY, MEMBER, "nao-existe", { level: "HISTORY" }, CTX)).rejects.toBeInstanceOf(NotFoundError);
    await expect(put(OWNER, FAMILY, MEMBER, "clinic-arch", { level: "HISTORY" }, CTX)).rejects.toBeInstanceOf(NotFoundError);
    await expect(put(OWNER, FAMILY, MEMBER, CLINIC, { level: "TUDO" }, CTX)).rejects.toBeInstanceOf(ValidationError);
  });

  it("autorização: tutor consente pelo dependente; DEPENDENT_SELF/OTHER/Platform Admin => FORBIDDEN; membro de outra família => NOT_FOUND (put, list, delete)", async () => {
    const { put, list, revoke } = setup();
    await expect(put(OWNER, FAMILY, DEPENDENT, CLINIC, { level: "BOOKINGS" }, CTX)).resolves.toBeDefined();
    for (const actor of [{ userId: "user-dep", platformAdmin: false }, { userId: "user-2", platformAdmin: false }, { userId: "user-1", platformAdmin: true }]) {
      const memberId = actor.userId === "user-dep" ? DEPENDENT : MEMBER;
      await expect(put(actor, FAMILY, memberId, CLINIC, { level: "HISTORY" }, CTX)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(list(actor, FAMILY, memberId)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(revoke(actor, FAMILY, memberId, CLINIC, CTX)).rejects.toBeInstanceOf(ForbiddenError);
    }
    const stranger = { userId: "estranho", platformAdmin: false };
    await expect(put(stranger, FAMILY, MEMBER, CLINIC, { level: "HISTORY" }, CTX)).rejects.toBeInstanceOf(NotFoundError);
    await expect(list(stranger, FAMILY, MEMBER)).rejects.toBeInstanceOf(NotFoundError);
    await expect(revoke(stranger, FAMILY, MEMBER, CLINIC, CTX)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("consentimento independente por clínica; HISTORY expirado aparece como BOOKINGS com renewalNeeded", async () => {
    const { fx, clock, put, list } = setup();
    fx.clinics.clinics.set("clinic-2", { id: "clinic-2", name: "Aurora", active: true });
    await put(OWNER, FAMILY, MEMBER, CLINIC, { level: "HISTORY" }, CTX);
    await put(OWNER, FAMILY, MEMBER, "clinic-2", { level: "BOOKINGS" }, CTX);
    expect((await list(OWNER, FAMILY, MEMBER)).map((c) => [c.clinicName, c.level])).toEqual([["Aurora", "BOOKINGS"], ["Clínica Sol", "HISTORY"]]);
    clock.advance(366 * 86_400_000);
    const after = await list(OWNER, FAMILY, MEMBER);
    expect(after.find((c) => c.clinicId === CLINIC)).toMatchObject({ level: "BOOKINGS", validUntil: null, renewalNeeded: true });
    expect(after.find((c) => c.clinicId === "clinic-2")).toMatchObject({ renewalNeeded: false });
  });

  it("revogar apaga consentimento E ligação; a clínica conserva o paciente, desligado; a leitura cessa no pedido seguinte; sem nada => NOT_FOUND", async () => {
    const { fx, gen, link, put, revoke, list, history } = setup();
    const view = await link(ACTOR, await gen(OWNER, FAMILY, MEMBER, CTX), CTX);
    await put(OWNER, FAMILY, MEMBER, CLINIC, { level: "HISTORY" }, CTX);
    fx.sharedHistory.medications = [{ name: "Metformina", dosage: "500 mg", startAt: NOW, endAt: null, continuous: true }];
    expect((await history(ACTOR, view.id, CTX)).active).toBe(true);
    await revoke(OWNER, FAMILY, MEMBER, CLINIC, CTX);
    expect(fx.audit.events.at(-1)).toMatchObject({ action: "CLINIC_CONSENT_REVOKE", actorType: "USER", metadata: { clinicId: CLINIC } });
    expect(fx.linksRepo.links).toEqual([]);
    expect(fx.consentsRepo.consents).toEqual([]);
    expect(fx.patientsRepo.byId.has(view.id)).toBe(true);
    expect(await list(OWNER, FAMILY, MEMBER)).toEqual([]);
    await expect(history(ACTOR, view.id, CTX)).resolves.toMatchObject({ active: false, medications: [], examinations: [] });
    await expect(revoke(OWNER, FAMILY, MEMBER, CLINIC, CTX)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("revogar é possível com a clínica arquivada", async () => {
    const { fx, put, revoke } = setup();
    await put(OWNER, FAMILY, MEMBER, CLINIC, { level: "BOOKINGS" }, CTX);
    fx.clinics.clinics.set(CLINIC, { id: CLINIC, name: "Clínica Sol", active: false });
    await expect(revoke(OWNER, FAMILY, MEMBER, CLINIC, CTX)).resolves.toBeUndefined();
  });
});
