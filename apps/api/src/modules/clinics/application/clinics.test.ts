import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createAdminCreateClinicUseCase, createAdminListClinicsUseCase, createAdminSetClinicStatusUseCase, createAdminUpdateClinicUseCase } from "./admin-clinics.js";
import { createCreatePrivateClinicUseCase } from "./create-private-clinic.js";
import { createDeletePrivateClinicUseCase } from "./delete-private-clinic.js";
import { createClinicsFixtures } from "./fixtures.js";
import { createGetBookableClinicUseCase } from "./get-bookable-clinic.js";
import { createListClinicsUseCase } from "./list-clinics.js";
import { createSetPrivateClinicStatusUseCase } from "./set-private-clinic-status.js";
import { createUpdatePrivateClinicUseCase } from "./update-private-clinic.js";

const NOW = new Date("2026-01-15T00:00:00.000Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const OTHER_FAMILY_ID = "f2";
const ADULT = { userId: "u1", platformAdmin: false };
const OTHER_ADULT = { userId: "u2", platformAdmin: false };
const MINOR = { userId: "u3", platformAdmin: false };
const PLATFORM_ADMIN = { userId: "admin1", platformAdmin: true };

function seedMembership(fixtures: ReturnType<typeof createClinicsFixtures>): void {
  fixtures.access.seed(FAMILY_ID, ADULT.userId, { memberId: "m1", role: "FAMILY_MEMBER", isAdult: true, status: "ACTIVE" });
  fixtures.access.seed(FAMILY_ID, OTHER_ADULT.userId, { memberId: "m2", role: "FAMILY_ADMIN", isAdult: true, status: "ACTIVE" });
  fixtures.access.seed(FAMILY_ID, MINOR.userId, { memberId: "m3", role: "FAMILY_MEMBER", isAdult: false, status: "ACTIVE" });
}

describe("createPrivateClinic (UC-CLN-01, BR-CLN-01)", () => {
  it("adulto da família cria uma clínica privada visível só à família", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    seedMembership(fixtures);
    const createPrivateClinic = createCreatePrivateClinicUseCase(fixtures.deps);

    const clinic = await createPrivateClinic(ADULT, FAMILY_ID, { name: "Clínica Sol" }, CTX);

    expect(clinic.type).toBe("PRIVATE");
    expect(clinic.familyId).toBe(FAMILY_ID);
    expect(clinic.status).toBe("ACTIVE");
    expect(fixtures.audit.events.some((e) => e.action === "CLINIC_CREATE")).toBe(true);
  });

  it("recusa menor (FORBIDDEN)", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    seedMembership(fixtures);
    const createPrivateClinic = createCreatePrivateClinicUseCase(fixtures.deps);

    await expect(createPrivateClinic(MINOR, FAMILY_ID, { name: "Clínica Sol" }, CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("recusa não-membro da família (NOT_FOUND)", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    seedMembership(fixtures);
    const createPrivateClinic = createCreatePrivateClinicUseCase(fixtures.deps);

    await expect(createPrivateClinic({ userId: "ghost", platformAdmin: false }, FAMILY_ID, { name: "Clínica Sol" }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("BR-CLN-01/B4: recusa a 11.ª clínica privada (LIMIT_EXCEEDED)", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    seedMembership(fixtures);
    const createPrivateClinic = createCreatePrivateClinicUseCase(fixtures.deps);
    for (let i = 0; i < 10; i += 1) {
      await createPrivateClinic(ADULT, FAMILY_ID, { name: `Clínica ${i.toString()}` }, CTX);
    }

    await expect(createPrivateClinic(ADULT, FAMILY_ID, { name: "Clínica 11" }, CTX)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  it("recusa nome vazio (VALIDATION_ERROR)", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    seedMembership(fixtures);
    const createPrivateClinic = createCreatePrivateClinicUseCase(fixtures.deps);

    await expect(createPrivateClinic(ADULT, FAMILY_ID, { name: "   " }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("listClinics (UC-CLN-02, AC-CLN-01)", () => {
  it("devolve parceiras (globais) + privadas só da própria família", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    seedMembership(fixtures);
    fixtures.access.seed(OTHER_FAMILY_ID, "u9", { memberId: "m9", role: "FAMILY_MEMBER", isAdult: true, status: "ACTIVE" });
    const createPrivateClinic = createCreatePrivateClinicUseCase(fixtures.deps);
    const adminCreateClinic = createAdminCreateClinicUseCase(fixtures.deps);
    const listClinics = createListClinicsUseCase(fixtures.deps);

    await createPrivateClinic(ADULT, FAMILY_ID, { name: "Privada F1" }, CTX);
    await createPrivateClinic({ userId: "u9", platformAdmin: false }, OTHER_FAMILY_ID, { name: "Privada F2" }, CTX);
    await adminCreateClinic(PLATFORM_ADMIN, { name: "Parceira Global" }, CTX);

    const visible = await listClinics(ADULT, FAMILY_ID, {});
    const names = visible.map((c) => c.name).sort();
    expect(names).toEqual(["Parceira Global", "Privada F1"]);
  });
});

describe("updatePrivateClinic/setPrivateClinicStatus/deletePrivateClinic (authorization.md §4)", () => {
  it("criador pode editar; outro membro (não Admin, não criador) é recusado", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    seedMembership(fixtures);
    const createPrivateClinic = createCreatePrivateClinicUseCase(fixtures.deps);
    const updatePrivateClinic = createUpdatePrivateClinicUseCase(fixtures.deps);
    const created = await createPrivateClinic(ADULT, FAMILY_ID, { name: "Clínica Sol" }, CTX);

    const updated = await updatePrivateClinic(ADULT, FAMILY_ID, created.id, { name: "Clínica Sol Novo" }, CTX);
    expect(updated.name).toBe("Clínica Sol Novo");

    fixtures.access.seed(FAMILY_ID, "u4", { memberId: "m4", role: "FAMILY_MEMBER", isAdult: true, status: "ACTIVE" });
    await expect(updatePrivateClinic({ userId: "u4", platformAdmin: false }, FAMILY_ID, created.id, { name: "Hack" }, CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("FAMILY_ADMIN (não criador) pode arquivar", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    seedMembership(fixtures);
    const createPrivateClinic = createCreatePrivateClinicUseCase(fixtures.deps);
    const setStatus = createSetPrivateClinicStatusUseCase(fixtures.deps);
    const created = await createPrivateClinic(ADULT, FAMILY_ID, { name: "Clínica Sol" }, CTX);

    const archived = await setStatus(OTHER_ADULT, FAMILY_ID, created.id, { status: "ARCHIVED" }, CTX);
    expect(archived.status).toBe("ARCHIVED");
  });

  it("BR-CLN-02: eliminar não falha mesmo que já esteja referenciada noutro lado (sem efeito aqui, só a linha)", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    seedMembership(fixtures);
    const createPrivateClinic = createCreatePrivateClinicUseCase(fixtures.deps);
    const deletePrivateClinic = createDeletePrivateClinicUseCase(fixtures.deps);
    const created = await createPrivateClinic(ADULT, FAMILY_ID, { name: "Clínica Sol" }, CTX);

    await deletePrivateClinic(ADULT, FAMILY_ID, created.id, CTX);

    expect(fixtures.clinicsRepo.byId.has(created.id)).toBe(false);
    expect(fixtures.audit.events.some((e) => e.action === "CLINIC_DELETE")).toBe(true);
  });

  it("NOT_FOUND para clínica de outra família", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    seedMembership(fixtures);
    fixtures.access.seed(OTHER_FAMILY_ID, "u9", { memberId: "m9", role: "FAMILY_ADMIN", isAdult: true, status: "ACTIVE" });
    const createPrivateClinic = createCreatePrivateClinicUseCase(fixtures.deps);
    const deletePrivateClinic = createDeletePrivateClinicUseCase(fixtures.deps);
    const created = await createPrivateClinic(ADULT, FAMILY_ID, { name: "Clínica Sol" }, CTX);

    await expect(deletePrivateClinic({ userId: "u9", platformAdmin: false }, OTHER_FAMILY_ID, created.id, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("admin clinics (UC-ADM-03, PLATFORM_ADMIN)", () => {
  it("cria, lista, altera e arquiva uma clínica parceira", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const adminCreateClinic = createAdminCreateClinicUseCase(fixtures.deps);
    const adminListClinics = createAdminListClinicsUseCase(fixtures.deps);
    const adminUpdateClinic = createAdminUpdateClinicUseCase(fixtures.deps);
    const adminSetClinicStatus = createAdminSetClinicStatusUseCase(fixtures.deps);

    const created = await adminCreateClinic(PLATFORM_ADMIN, { name: "Clínica Central" }, CTX);
    expect(created.type).toBe("PARTNER");

    const list = await adminListClinics(PLATFORM_ADMIN, {});
    expect(list).toHaveLength(1);

    const updated = await adminUpdateClinic(PLATFORM_ADMIN, created.id, { name: "Clínica Central Renovada" }, CTX);
    expect(updated.name).toBe("Clínica Central Renovada");

    const archived = await adminSetClinicStatus(PLATFORM_ADMIN, created.id, { status: "ARCHIVED" }, CTX);
    expect(archived.status).toBe("ARCHIVED");
  });

  it("recusa ator que não é Platform Admin (FORBIDDEN)", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    const adminCreateClinic = createAdminCreateClinicUseCase(fixtures.deps);

    await expect(adminCreateClinic(ADULT, { name: "Clínica Central" }, CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("não deixa editar uma clínica privada pela rota de admin (NOT_FOUND)", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    seedMembership(fixtures);
    const createPrivateClinic = createCreatePrivateClinicUseCase(fixtures.deps);
    const adminUpdateClinic = createAdminUpdateClinicUseCase(fixtures.deps);
    const created = await createPrivateClinic(ADULT, FAMILY_ID, { name: "Clínica Sol" }, CTX);

    await expect(adminUpdateClinic(PLATFORM_ADMIN, created.id, { name: "Hack" }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("getBookableClinic (API pública para appointments/examinations)", () => {
  it("devolve a clínica ativa (parceira ou privada da família)", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    seedMembership(fixtures);
    const createPrivateClinic = createCreatePrivateClinicUseCase(fixtures.deps);
    const getBookableClinic = createGetBookableClinicUseCase(fixtures.deps);
    const created = await createPrivateClinic(ADULT, FAMILY_ID, { name: "Clínica Sol" }, CTX);

    const bookable = await getBookableClinic(fixtures.deps.db, FAMILY_ID, created.id);
    expect(bookable).toEqual({ id: created.id, name: "Clínica Sol" });
  });

  it("devolve null para clínica arquivada, de outra família, ou inexistente", async () => {
    const fixtures = createClinicsFixtures(new FixedClock(NOW));
    seedMembership(fixtures);
    const createPrivateClinic = createCreatePrivateClinicUseCase(fixtures.deps);
    const setStatus = createSetPrivateClinicStatusUseCase(fixtures.deps);
    const getBookableClinic = createGetBookableClinicUseCase(fixtures.deps);
    const created = await createPrivateClinic(ADULT, FAMILY_ID, { name: "Clínica Sol" }, CTX);
    await setStatus(ADULT, FAMILY_ID, created.id, { status: "ARCHIVED" }, CTX);

    expect(await getBookableClinic(fixtures.deps.db, FAMILY_ID, created.id)).toBeNull();
    expect(await getBookableClinic(fixtures.deps.db, OTHER_FAMILY_ID, created.id)).toBeNull();
    expect(await getBookableClinic(fixtures.deps.db, FAMILY_ID, "nope")).toBeNull();
  });
});
