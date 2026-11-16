/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- respostas HTTP/linhas SQL de teste sem tipagem (supertest devolve `any`). */
// Integração (PostgreSQL real + API real validada contra o openapi.yaml, pedidos E respostas) do catálogo de especialidades (MK1 S4):
// TC-MKT-19 / UC-MKT-07 / UC-MKT-03, BR-MKT-02/22. Admin cria/lista/renomeia/desativa, categoria imutável com uso, tokens cruzados e auditoria sem o nome.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startProfessionalsHarness, type ProfessionalsHarness } from "../support/professionals-harness.js";

const ADMIN_SPECIALTIES = "/api/v1/admin/specialties";
const PORTAL_SPECIALTIES = "/api/v1/professional-portal/specialties";

describe("integração: catálogo de especialidades (MK1 S4, TC-MKT-19)", () => {
  let h: ProfessionalsHarness;
  let admin: string;
  let user: string;
  let clinic: string;
  let uniq = 0;
  const name = (prefix: string) => `${prefix} ${String(++uniq)}`;

  beforeAll(async () => {
    h = await startProfessionalsHarness();
    admin = await h.adminToken();
    user = await h.userToken();
    clinic = await h.clinicToken();
  });
  afterAll(async () => {
    await h.stop();
  });

  const createSpecialty = (body: unknown) => request(h.app).post(ADMIN_SPECIALTIES).set("Authorization", `Bearer ${admin}`).send(body as object);
  const patchSpecialty = (id: string, body: unknown) => request(h.app).patch(`${ADMIN_SPECIALTIES}/${id}`).set("Authorization", `Bearer ${admin}`).send(body as object);
  /** Cria uma especialidade válida e devolve o corpo (201). */
  const seed = async (category: "HEALTH" | "WELLNESS" = "HEALTH", prefix = "Esp") => {
    const res = await createSpecialty({ name: name(prefix), category }).expect(201);
    return res.body as { id: string; name: string; category: string; active: boolean; professionalCount: number };
  };

  describe("criação (UC-MKT-07)", () => {
    it("admin cria: 201 com os campos de AdminSpecialty, ativa e sem profissionais", async () => {
      const nome = name("Nutrição");
      const res = await createSpecialty({ name: nome, category: "HEALTH" }).expect(201);
      expect(res.body).toEqual({ id: expect.any(String), name: nome, category: "HEALTH", active: true, professionalCount: 0 });
    });

    it("nome duplicado sem distinção de maiúsculas (e com espaços à volta) -> 409 CONFLICT", async () => {
      const base = name("Yoga");
      await createSpecialty({ name: base, category: "WELLNESS" }).expect(201);
      const res = await createSpecialty({ name: `  ${base.toUpperCase()}  `, category: "WELLNESS" }).expect(409);
      expect(res.body).toMatchObject({ code: "CONFLICT" });
    });

    it.each([
      ["1 carácter", "A"],
      ["81 caracteres", "a".repeat(81)],
    ])("nome com %s -> 422 VALIDATION_ERROR", async (_label, nome) => {
      const res = await createSpecialty({ name: nome, category: "HEALTH" }).expect(422);
      expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("categoria inválida -> 422 VALIDATION_ERROR", async () => {
      const res = await createSpecialty({ name: name("Outra"), category: "OTHER" }).expect(422);
      expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("campo extra no corpo -> 422 (contrato SpecialtyInput sem campos adicionais)", async () => {
      await createSpecialty({ name: name("Extra"), category: "HEALTH", active: false }).expect(422);
    });
  });

  describe("lista e contagem de profissionais (UC-MKT-07)", () => {
    it("admin lista todas (incluindo inativas) com professionalCount = nº de ligações", async () => {
      const created = await seed("HEALTH", "Lista");
      const pro = await h.newProfessional();
      await h.pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1, $2)", [pro.professionalId, created.id]);
      await patchSpecialty(created.id, { active: false }).expect(200);

      const res = await request(h.app).get(ADMIN_SPECIALTIES).set("Authorization", `Bearer ${admin}`).expect(200);
      const row = (res.body as { id: string; professionalCount: number; active: boolean }[]).find((s) => s.id === created.id);
      expect(row).toEqual({ id: created.id, name: created.name, category: "HEALTH", active: false, professionalCount: 1 });
    });
  });

  describe("alteração (UC-MKT-07)", () => {
    it("renomeia (aparado) e devolve a especialidade atualizada", async () => {
      const created = await seed("WELLNESS", "Renomear");
      const nova = name("Pilates");
      const res = await patchSpecialty(created.id, { name: `  ${nova}  ` }).expect(200);
      expect(res.body).toEqual({ id: created.id, name: nova, category: "WELLNESS", active: true, professionalCount: 0 });
    });

    it("renomear para o nome de OUTRA especialidade (sem maiúsculas) -> 409", async () => {
      const outra = await seed("HEALTH", "Alvo");
      const created = await seed("HEALTH", "Origem");
      const res = await patchSpecialty(created.id, { name: outra.name.toLowerCase() }).expect(409);
      expect(res.body).toMatchObject({ code: "CONFLICT" });
    });

    it("mudar só a capitalização do próprio nome é permitido", async () => {
      const created = await seed("HEALTH", "Caixa");
      const res = await patchSpecialty(created.id, { name: created.name.toUpperCase() }).expect(200);
      expect(res.body).toMatchObject({ id: created.id, name: created.name.toUpperCase() });
    });

    it("desativa e reativa (nunca apaga)", async () => {
      const created = await seed("HEALTH", "Ativa");
      const off = await patchSpecialty(created.id, { active: false }).expect(200);
      expect(off.body).toMatchObject({ id: created.id, active: false });
      const on = await patchSpecialty(created.id, { active: true }).expect(200);
      expect(on.body).toMatchObject({ id: created.id, active: true });
    });

    it("mudar a categoria com profissional a usar -> 409; sem uso -> 200", async () => {
      const emUso = await seed("HEALTH", "EmUso");
      const pro = await h.newProfessional();
      await h.pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1, $2)", [pro.professionalId, emUso.id]);
      const blocked = await patchSpecialty(emUso.id, { category: "WELLNESS" }).expect(409);
      expect(blocked.body).toMatchObject({ code: "CONFLICT" });

      const semUso = await seed("HEALTH", "SemUso");
      const changed = await patchSpecialty(semUso.id, { category: "WELLNESS" }).expect(200);
      expect(changed.body).toMatchObject({ id: semUso.id, category: "WELLNESS" });
    });

    it("mesma categoria com profissional a usar não é conflito", async () => {
      const emUso = await seed("HEALTH", "MesmaCat");
      const pro = await h.newProfessional();
      await h.pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1, $2)", [pro.professionalId, emUso.id]);
      await patchSpecialty(emUso.id, { category: "HEALTH", active: false }).expect(200);
    });

    it("PATCH de especialidade inexistente -> 404", async () => {
      const res = await patchSpecialty(randomUUID(), { active: false }).expect(404);
      expect(res.body).toMatchObject({ code: "NOT_FOUND" });
    });

    it("PATCH vazio -> 422", async () => {
      const created = await seed();
      await patchSpecialty(created.id, {}).expect(422);
    });

    it("PATCH com nome inválido -> 422", async () => {
      const created = await seed();
      await patchSpecialty(created.id, { name: "A" }).expect(422);
    });
  });

  describe("autorização", () => {
    it("utilizador que não é Platform Admin -> 403 em todas as rotas de administração", async () => {
      const created = await seed();
      await request(h.app).get(ADMIN_SPECIALTIES).set("Authorization", `Bearer ${user}`).expect(403);
      await request(h.app).post(ADMIN_SPECIALTIES).set("Authorization", `Bearer ${user}`).send({ name: name("Negada"), category: "HEALTH" }).expect(403);
      await request(h.app).patch(`${ADMIN_SPECIALTIES}/${created.id}`).set("Authorization", `Bearer ${user}`).send({ active: false }).expect(403);
    });

    it("token de profissional ou de clínica em /admin/specialties -> 401", async () => {
      const pro = await h.newProfessional();
      await request(h.app).get(ADMIN_SPECIALTIES).set("Authorization", `Bearer ${pro.token}`).expect(401);
      await request(h.app).get(ADMIN_SPECIALTIES).set("Authorization", `Bearer ${clinic}`).expect(401);
      await request(h.app).post(ADMIN_SPECIALTIES).set("Authorization", `Bearer ${pro.token}`).send({ name: name("X"), category: "HEALTH" }).expect(401);
    });

    it("sem token em /admin/specialties -> 401", async () => {
      await request(h.app).get(ADMIN_SPECIALTIES).expect(401);
      await request(h.app).post(ADMIN_SPECIALTIES).send({ name: name("Anon"), category: "HEALTH" }).expect(401);
    });

    it("portal: sem token -> 401; token de User ou de clínica -> 401", async () => {
      await request(h.app).get(PORTAL_SPECIALTIES).expect(401);
      await request(h.app).get(PORTAL_SPECIALTIES).set("Authorization", `Bearer ${user}`).expect(401);
      await request(h.app).get(PORTAL_SPECIALTIES).set("Authorization", `Bearer ${clinic}`).expect(401);
    });
  });

  describe("catálogo para o profissional (UC-MKT-03)", () => {
    it("só lista as ativas, ordenadas por nome, apenas com {id, name, category}", async () => {
      const zeta = await seed("WELLNESS", "Zeta");
      const alfa = await seed("HEALTH", "Alfa");
      const inativa = await seed("HEALTH", "Inativa");
      await patchSpecialty(inativa.id, { active: false }).expect(200);
      const pro = await h.newProfessional();

      const res = await request(h.app).get(PORTAL_SPECIALTIES).set("Authorization", `Bearer ${pro.token}`).expect(200);
      const items = res.body as Record<string, unknown>[];
      expect(items.every((s) => Object.keys(s).sort().join(",") === "category,id,name")).toBe(true);
      expect(items.some((s) => s.id === inativa.id)).toBe(false);
      const ids = items.map((s) => s.id);
      expect(ids).toContain(alfa.id);
      expect(ids).toContain(zeta.id);
      const names = items.map((s) => s.name as string);
      expect(names.indexOf(alfa.name)).toBeLessThan(names.indexOf(zeta.name));
      expect(items.find((s) => s.id === alfa.id)).toEqual({ id: alfa.id, name: alfa.name, category: "HEALTH" });
    });

    it("reativar devolve a especialidade ao catálogo do portal", async () => {
      const created = await seed("HEALTH", "Volta");
      await patchSpecialty(created.id, { active: false }).expect(200);
      await patchSpecialty(created.id, { active: true }).expect(200);
      const pro = await h.newProfessional();
      const res = await request(h.app).get(PORTAL_SPECIALTIES).set("Authorization", `Bearer ${pro.token}`).expect(200);
      expect((res.body as { id: string }[]).some((s) => s.id === created.id)).toBe(true);
    });
  });

  describe("auditoria (audit.md §3, BR-HLT-05)", () => {
    it("ADMIN_SPECIALTY_CREATE e ADMIN_SPECIALTY_UPDATE existem, com ator PLATFORM_ADMIN e sem o nome no metadata", async () => {
      const secreto = `Segredo ${randomUUID()}`;
      const created = await createSpecialty({ name: secreto, category: "WELLNESS" }).expect(201);
      await patchSpecialty(created.body.id as string, { name: `${secreto} B`, active: false }).expect(200);

      const createdRow = (
        await h.pool.query<{ actor_type: string; actor_user_id: string; result: string; resource_type: string; resource_id: string; metadata: Record<string, unknown> }>(
          "SELECT actor_type, actor_user_id, result, resource_type, resource_id, metadata FROM audit_logs WHERE action = 'ADMIN_SPECIALTY_CREATE' AND resource_id = $1",
          [created.body.id],
        )
      ).rows[0];
      expect(createdRow).toMatchObject({ actor_type: "PLATFORM_ADMIN", result: "SUCCESS", resource_type: "Specialty", metadata: { category: "WELLNESS" } });

      const updatedRow = (
        await h.pool.query<{ metadata: Record<string, unknown> }>("SELECT metadata FROM audit_logs WHERE action = 'ADMIN_SPECIALTY_UPDATE' AND resource_id = $1", [created.body.id])
      ).rows[0];
      expect(updatedRow?.metadata).toEqual({ fields: "name,active" });

      const all = await h.pool.query<{ metadata: unknown }>("SELECT metadata FROM audit_logs WHERE action IN ('ADMIN_SPECIALTY_CREATE','ADMIN_SPECIALTY_UPDATE') AND resource_id = $1", [created.body.id]);
      expect(all.rows.length).toBe(2);
      expect(JSON.stringify(all.rows)).not.toContain(secreto);
    });
  });
});
