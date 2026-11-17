/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- respostas HTTP/linhas SQL de teste sem tipagem (supertest devolve `any`). */
// Integração (PostgreSQL real + API real validada contra o openapi.yaml, pedidos E respostas) das ofertas e preços em Kz do profissional
// (MK1 S8): UC-MKT-08, BR-MKT-03/24/31, TC-MKT-23/24/37 (ver nota no relatório), TC-AZ-MKT-02/03 (matriz e IDOR), authorization.md §10.1/§10.2,
// audit.md §3 (sem preços nem notas em auditoria). Cada teste cria os seus profissionais e especialidades.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROFESSIONAL_API, startProfessionalsHarness, type ProfessionalsHarness } from "../support/professionals-harness.js";

const OFFERS = `${PROFESSIONAL_API}/offers`;

type Status = "DRAFT" | "PENDING_REVIEW" | "NEEDS_INFO" | "APPROVED" | "REJECTED" | "SUSPENDED";
type Method = "IN_PERSON" | "VIDEO" | "CHAT" | "PHONE";
type Category = "HEALTH" | "WELLNESS";

const ESTADOS: readonly Status[] = ["DRAFT", "PENDING_REVIEW", "NEEDS_INFO", "APPROVED", "REJECTED", "SUSPENDED"];
/** authorization.md §10.2: criar/alterar ofertas é permitido em todos os estados exceto REJECTED e SUSPENDED. */
const OFFERS_OK: readonly Status[] = ["DRAFT", "PENDING_REVIEW", "NEEDS_INFO", "APPROVED"];
const METHODS: readonly Method[] = ["IN_PERSON", "VIDEO", "CHAT", "PHONE"];
const DURATIONS: readonly number[] = [15, 20, 30, 45, 60];
const OFFER_KEYS = ["active", "durationMinutes", "id", "method", "note", "priceKz", "specialtyId"];

describe("integração: ofertas e preços em Kz do profissional (MK1 S8)", () => {
  let h: ProfessionalsHarness;

  beforeAll(async () => {
    h = await startProfessionalsHarness();
  });
  afterAll(async () => {
    await h.stop();
  });

  // ---------------------------------------------------------------- helpers locais

  /** Força o estado de validação por SQL (pré-condição de teste; contorna a máquina de estados de propósito). */
  async function setState(professionalId: string, status: Status, reason: string | null = null): Promise<void> {
    await h.pool.query(
      `UPDATE professionals SET
         validation_status = $2::professional_validation_status,
         status_reason = $3,
         status_changed_at = now(),
         submitted_at = CASE WHEN $2::professional_validation_status = 'DRAFT' THEN NULL ELSE COALESCE(submitted_at, now()) END,
         approved_at = CASE WHEN $2::professional_validation_status = 'APPROVED' THEN COALESCE(approved_at, now()) ELSE NULL END,
         display_name = CASE WHEN $2::professional_validation_status = 'APPROVED' THEN COALESCE(display_name, 'Nome Aprovado') ELSE display_name END,
         city = CASE WHEN $2::professional_validation_status = 'APPROVED' THEN COALESCE(city, 'Luanda') ELSE city END,
         updated_at = now()
       WHERE id = $1`,
      [professionalId, status, reason],
    );
  }

  /** Especialidade do catálogo (nome único por construção, a não ser que `name` seja dado). */
  async function insertSpecialty(category: Category, name = `Especialidade ${randomUUID()}`, active = true): Promise<string> {
    const { rows } = await h.pool.query<{ id: string }>("INSERT INTO specialties (name, category, active) VALUES ($1, $2, $3) RETURNING id", [name, category, active]);
    return rows[0]?.id ?? "";
  }

  /** Cria uma especialidade do catálogo e liga-a ao profissional por SQL; devolve o id da especialidade. */
  async function linkedSpecialty(professionalId: string, name?: string): Promise<string> {
    const id = await insertSpecialty("HEALTH", name);
    await h.pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1, $2)", [professionalId, id]);
    return id;
  }

  /** Corpo válido de criação (sobrescrevível). */
  function offerBody(specialtyId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { specialtyId, method: "IN_PERSON", durationMinutes: 30, priceKz: 5000, note: null, ...extra };
  }

  /** Ids pela ordem da resposta (tipada, sem `any`). */
  const idsOf = (res: { body: unknown }): string[] => (res.body as { id: string }[]).map((o) => o.id);

  const listOffers = (token: string, query = "") => request(h.app).get(`${OFFERS}${query}`).set("Authorization", `Bearer ${token}`);
  const createOffer = (token: string, body: unknown) => request(h.app).post(OFFERS).set("Authorization", `Bearer ${token}`).send(body as object);
  const patchOffer = (token: string, id: string, body: unknown) => request(h.app).patch(`${OFFERS}/${id}`).set("Authorization", `Bearer ${token}`).send(body as object);

  /** Estado completo das ofertas de um profissional (para provar que nada mudou). */
  async function offersOf(professionalId: string): Promise<Record<string, unknown>[]> {
    const { rows } = await h.pool.query<Record<string, unknown>>(
      "SELECT id, specialty_id, method, duration_minutes, price_kz, note, active FROM professional_offers WHERE professional_id = $1 ORDER BY id",
      [professionalId],
    );
    return rows;
  }

  async function offerRow(offerId: string) {
    const { rows } = await h.pool.query<{ id: string; specialty_id: string; method: string; duration_minutes: number; price_kz: number; note: string | null; active: boolean; professional_id: string }>(
      "SELECT id, professional_id, specialty_id, method, duration_minutes, price_kz, note, active FROM professional_offers WHERE id = $1",
      [offerId],
    );
    return rows[0];
  }

  async function countOffers(professionalId: string, active?: boolean): Promise<number> {
    const { rows } = await h.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM professional_offers WHERE professional_id = $1 AND ($2::boolean IS NULL OR active = $2)",
      [professionalId, active ?? null],
    );
    return rows[0]?.n ?? 0;
  }

  async function accessDeniedCount(accountId: string): Promise<number> {
    const { rows } = await h.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'ACCESS_DENIED' AND actor_professional_account_id = $1", [accountId]);
    return rows[0]?.n ?? 0;
  }

  // ---------------------------------------------------------------- (1) criação: campos válidos e rejeições

  describe("POST /offers: campos válidos", () => {
    it.each(METHODS)("aceita o método %s (201)", async (method) => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const res = await createOffer(pro.token, offerBody(spec, { method })).expect(201);
      expect(res.body).toMatchObject({ specialtyId: spec, method, durationMinutes: 30, priceKz: 5000, note: null, active: true });
    });

    it.each(DURATIONS)("aceita a duração %i minutos (201)", async (durationMinutes) => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const res = await createOffer(pro.token, offerBody(spec, { durationMinutes })).expect(201);
      expect(res.body.durationMinutes).toBe(durationMinutes);
    });

    it("aceita preço 0 (gratuito) e 100000000 (limite superior)", async () => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const gratis = await createOffer(pro.token, offerBody(spec, { priceKz: 0 })).expect(201);
      const maximo = await createOffer(pro.token, offerBody(spec, { method: "VIDEO", priceKz: 100000000 })).expect(201);
      expect(gratis.body.priceKz).toBe(0);
      expect(maximo.body.priceKz).toBe(100000000);
    });

    it("apara a nota e converte '' e só espaços em null", async () => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const aparada = await createOffer(pro.token, offerBody(spec, { note: "  Rua 1, nº 2  " })).expect(201);
      const vazia = await createOffer(pro.token, offerBody(spec, { method: "CHAT", note: "" })).expect(201);
      const espacos = await createOffer(pro.token, offerBody(spec, { method: "PHONE", note: "   " })).expect(201);
      expect(aparada.body.note).toBe("Rua 1, nº 2");
      expect(vazia.body.note).toBeNull();
      expect(espacos.body.note).toBeNull();
    });

    it("nota com 200 caracteres é aceite", async () => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const res = await createOffer(pro.token, offerBody(spec, { note: "n".repeat(200) })).expect(201);
      expect(res.body.note).toBe("n".repeat(200));
    });

    it("resposta só com id, specialtyId, method, durationMinutes, priceKz, note, active (sem professionalId)", async () => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const res = await createOffer(pro.token, offerBody(spec)).expect(201);
      expect(Object.keys(res.body).sort()).toEqual(OFFER_KEYS);
      expect(res.body).not.toHaveProperty("professionalId");
      expect(JSON.stringify(res.body)).not.toContain(pro.professionalId);
    });
  });

  describe("POST /offers: rejeições 422", () => {
    it.each([
      ["priceKz fracionário 1000.5", { priceKz: 1000.5 }],
      ["priceKz negativo", { priceKz: -1 }],
      ["priceKz acima do máximo (100000001)", { priceKz: 100000001 }],
      ["priceKz em string '1e3'", { priceKz: "1e3" }],
      ["priceKz null", { priceKz: null }],
      ["priceKz em falta", { priceKz: undefined }],
      ["durationMinutes 25", { durationMinutes: 25 }],
      ["durationMinutes 0", { durationMinutes: 0 }],
      ["durationMinutes 90", { durationMinutes: 90 }],
      ["método inválido", { method: "VIDEOCALL" }],
      ["specialtyId que não é uuid", { specialtyId: "nao-uuid" }],
      ["nota com 201 caracteres", { note: "n".repeat(201) }],
      ["campo extra", { role: "ADMIN" }],
    ])("%s -> 422 VALIDATION_ERROR, nada criado", async (_label, override) => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const body = offerBody(spec, override);
      if (override.priceKz === undefined && "priceKz" in override) delete body.priceKz;
      const before = await countOffers(pro.professionalId);
      const res = await createOffer(pro.token, body).expect(422);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(await countOffers(pro.professionalId)).toBe(before);
    });

    it("sem campos obrigatórios (só specialtyId) -> 422", async () => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const res = await createOffer(pro.token, { specialtyId: spec }).expect(422);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("especialidade de OUTRO profissional -> 422 VALIDATION_ERROR", async () => {
      const dono = await h.newProfessional();
      const outro = await h.newProfessional();
      const specDoDono = await linkedSpecialty(dono.professionalId);
      const res = await createOffer(outro.token, offerBody(specDoDono)).expect(422);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(await countOffers(outro.professionalId)).toBe(0);
    });

    it("especialidade do catálogo que NÃO é do profissional -> 422", async () => {
      const pro = await h.newProfessional();
      const naoLigada = await insertSpecialty("HEALTH");
      const res = await createOffer(pro.token, offerBody(naoLigada)).expect(422);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("especialidade inexistente -> 422 VALIDATION_ERROR", async () => {
      const pro = await h.newProfessional();
      const res = await createOffer(pro.token, offerBody(randomUUID())).expect(422);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("especialidade ligada ao profissional mas DESATIVADA no catálogo -> 422", async () => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      await h.pool.query("UPDATE specialties SET active = false WHERE id = $1", [spec]);
      const res = await createOffer(pro.token, offerBody(spec)).expect(422);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(await countOffers(pro.professionalId)).toBe(0);
    });
  });

  // ---------------------------------------------------------------- (2) duplicados

  describe("duplicados ativos (mesma especialidade + método + duração)", () => {
    it("segunda oferta ativa igual -> 409 CONFLICT, uma só linha", async () => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      await createOffer(pro.token, offerBody(spec)).expect(201);
      const res = await createOffer(pro.token, offerBody(spec, { priceKz: 9000 })).expect(409);
      expect(res.body.code).toBe("CONFLICT");
      expect(await countOffers(pro.professionalId)).toBe(1);
    });

    it("após desativar a primeira, criar de novo é permitido", async () => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const primeira = await createOffer(pro.token, offerBody(spec)).expect(201);
      await patchOffer(pro.token, primeira.body.id, { active: false }).expect(200);
      const segunda = await createOffer(pro.token, offerBody(spec)).expect(201);
      expect(segunda.body.id).not.toBe(primeira.body.id);
      expect(await countOffers(pro.professionalId, true)).toBe(1);
    });

    it("mesma especialidade e método com duração diferente, ou mesma duração com método diferente, são permitidas", async () => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      await createOffer(pro.token, offerBody(spec, { durationMinutes: 30 })).expect(201);
      await createOffer(pro.token, offerBody(spec, { durationMinutes: 45 })).expect(201);
      await createOffer(pro.token, offerBody(spec, { method: "VIDEO", durationMinutes: 30 })).expect(201);
      expect(await countOffers(pro.professionalId, true)).toBe(3);
    });

    it("mesma chave com outra especialidade é permitida", async () => {
      const pro = await h.newProfessional();
      const a = await linkedSpecialty(pro.professionalId);
      const b = await linkedSpecialty(pro.professionalId);
      await createOffer(pro.token, offerBody(a)).expect(201);
      await createOffer(pro.token, offerBody(b)).expect(201);
      expect(await countOffers(pro.professionalId, true)).toBe(2);
    });

    it("reativar a antiga enquanto existe outra ativa igual -> 409 CONFLICT, continua inativa", async () => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const antiga = await createOffer(pro.token, offerBody(spec)).expect(201);
      await patchOffer(pro.token, antiga.body.id, { active: false }).expect(200);
      await createOffer(pro.token, offerBody(spec)).expect(201);
      const res = await patchOffer(pro.token, antiga.body.id, { active: true }).expect(409);
      expect(res.body.code).toBe("CONFLICT");
      expect((await offerRow(antiga.body.id))?.active).toBe(false);
    });

    it("duas criações iguais em paralelo (Promise.all) -> uma 201, uma 409 CONFLICT e uma só linha", async () => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const body = offerBody(spec, { method: "CHAT", durationMinutes: 20 });
      const [a, b] = await Promise.all([createOffer(pro.token, body), createOffer(pro.token, body)]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const perdedora = a.status === 409 ? a : b;
      expect(perdedora.body.code).toBe("CONFLICT");
      expect(await countOffers(pro.professionalId, true)).toBe(1);
    });
  });

  // ---------------------------------------------------------------- (3) limite de 20 ativas

  describe("limite de 20 ofertas ativas", () => {
    it("20 ativas OK; a 21.ª -> 409 LIMIT_EXCEEDED; inativas não contam; desativar liberta lugar; reativar a 21.ª -> 409", async () => {
      const pro = await h.newProfessional();
      const spA = await linkedSpecialty(pro.professionalId);
      const spB = await linkedSpecialty(pro.professionalId);

      // Inativa de propósito: não pode contar para o limite nem bloquear o duplicado da mesma chave.
      const inativa = await createOffer(pro.token, offerBody(spB, { method: "CHAT", durationMinutes: 15 })).expect(201);
      await patchOffer(pro.token, inativa.body.id, { active: false }).expect(200);

      const ids: Record<string, string> = {};
      // 20 ativas: 10 em A (IN_PERSON/VIDEO × 5 durações) e 10 em B (CHAT/PHONE × 5 durações, incluindo a chave da inativa).
      for (const method of ["IN_PERSON", "VIDEO"] as const) {
        for (const durationMinutes of DURATIONS) {
          const res = await createOffer(pro.token, offerBody(spA, { method, durationMinutes })).expect(201);
          ids[`A-${method}-${String(durationMinutes)}`] = res.body.id;
        }
      }
      for (const method of ["CHAT", "PHONE"] as const) {
        for (const durationMinutes of DURATIONS) {
          await createOffer(pro.token, offerBody(spB, { method, durationMinutes })).expect(201);
        }
      }
      expect(await countOffers(pro.professionalId, true)).toBe(20);
      expect(await countOffers(pro.professionalId, false)).toBe(1);

      const vigesimaPrimeira = await createOffer(pro.token, offerBody(spA, { method: "CHAT", durationMinutes: 15 })).expect(409);
      expect(vigesimaPrimeira.body.code).toBe("LIMIT_EXCEEDED");
      expect(await countOffers(pro.professionalId, true)).toBe(20);

      // Desativar uma liberta lugar.
      await patchOffer(pro.token, ids["A-IN_PERSON-15"] ?? "", { active: false }).expect(200);
      await createOffer(pro.token, offerBody(spA, { method: "CHAT", durationMinutes: 15 })).expect(201);
      expect(await countOffers(pro.professionalId, true)).toBe(20);

      // Reativar a 21.ª ativa (a antiga A-IN_PERSON-15) ⇒ LIMIT_EXCEEDED e continua inativa.
      const reativar = await patchOffer(pro.token, ids["A-IN_PERSON-15"] ?? "", { active: true }).expect(409);
      expect(reativar.body.code).toBe("LIMIT_EXCEEDED");
      expect(await countOffers(pro.professionalId, true)).toBe(20);
      expect((await offerRow(ids["A-IN_PERSON-15"] ?? ""))?.active).toBe(false);
    });

    it("o limite é por profissional: outro profissional continua a poder criar", async () => {
      const cheio = await h.newProfessional();
      const outro = await h.newProfessional();
      const spCheio = await linkedSpecialty(cheio.professionalId);
      for (const method of METHODS) for (const durationMinutes of DURATIONS) await createOffer(cheio.token, offerBody(spCheio, { method, durationMinutes })).expect(201);
      await createOffer(cheio.token, offerBody(spCheio, { method: "IN_PERSON", durationMinutes: 15, priceKz: 1 })).expect(409);
      const spOutro = await linkedSpecialty(outro.professionalId);
      await createOffer(outro.token, offerBody(spOutro)).expect(201);
    });
  });

  // ---------------------------------------------------------------- (4) PATCH e GET

  describe("PATCH /offers/:id", () => {
    it("altera priceKz e note (200) e devolve a oferta completa", async () => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const criada = await createOffer(pro.token, offerBody(spec)).expect(201);
      const res = await patchOffer(pro.token, criada.body.id, { priceKz: 7500, note: "  Nova morada  " }).expect(200);
      expect(Object.keys(res.body).sort()).toEqual(OFFER_KEYS);
      expect(res.body).toMatchObject({ id: criada.body.id, specialtyId: spec, method: "IN_PERSON", durationMinutes: 30, priceKz: 7500, note: "Nova morada", active: true });
    });

    it("note '' limpa a nota (null)", async () => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const criada = await createOffer(pro.token, offerBody(spec, { note: "antiga" })).expect(201);
      const res = await patchOffer(pro.token, criada.body.id, { note: "" }).expect(200);
      expect(res.body.note).toBeNull();
    });

    it("active false e depois true (200)", async () => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const criada = await createOffer(pro.token, offerBody(spec)).expect(201);
      const desativada = await patchOffer(pro.token, criada.body.id, { active: false }).expect(200);
      expect(desativada.body.active).toBe(false);
      const reativada = await patchOffer(pro.token, criada.body.id, { active: true }).expect(200);
      expect(reativada.body.active).toBe(true);
    });

    it("body vazio {} -> 422", async () => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const criada = await createOffer(pro.token, offerBody(spec)).expect(201);
      const res = await patchOffer(pro.token, criada.body.id, {}).expect(422);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it.each([
      ["specialtyId", () => ({ specialtyId: randomUUID() })],
      ["method", () => ({ method: "CHAT" })],
      ["durationMinutes", () => ({ durationMinutes: 45 })],
    ])("%s no body -> 422 (imutável), sem alterar nada", async (_campo, change) => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const criada = await createOffer(pro.token, offerBody(spec)).expect(201);
      const antes = await offersOf(pro.professionalId);
      const res = await patchOffer(pro.token, criada.body.id, { ...change(), priceKz: 1234 }).expect(422);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(await offersOf(pro.professionalId)).toEqual(antes);
    });

    it("oferta de OUTRO profissional -> 404 e nada muda", async () => {
      const dono = await h.newProfessional();
      const intruso = await h.newProfessional();
      const spec = await linkedSpecialty(dono.professionalId);
      const criada = await createOffer(dono.token, offerBody(spec)).expect(201);
      const antes = await offersOf(dono.professionalId);
      await patchOffer(intruso.token, criada.body.id, { priceKz: 1, active: false }).expect(404);
      expect(await offersOf(dono.professionalId)).toEqual(antes);
    });

    it("id inexistente -> 404 com a mesma resposta que o recurso alheio (sem enumeração)", async () => {
      const dono = await h.newProfessional();
      const intruso = await h.newProfessional();
      const spec = await linkedSpecialty(dono.professionalId);
      const alheia = await createOffer(dono.token, offerBody(spec)).expect(201);
      const alheioRes = await patchOffer(intruso.token, alheia.body.id, { priceKz: 2 }).expect(404);
      const inexistenteRes = await patchOffer(intruso.token, randomUUID(), { priceKz: 2 }).expect(404);
      // `requestId` é único por pedido; o resto da resposta tem de ser idêntico.
      expect({ ...inexistenteRes.body, requestId: undefined }).toEqual({ ...alheioRes.body, requestId: undefined });
    });

    it("mudar o preço em APPROVED é permitido (OP-62) e não altera mais nada", async () => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const criada = await createOffer(pro.token, offerBody(spec, { note: "fixa" })).expect(201);
      await setState(pro.professionalId, "APPROVED");
      const antes = await offerRow(criada.body.id);
      await patchOffer(pro.token, criada.body.id, { priceKz: 12000 }).expect(200);
      const depois = await offerRow(criada.body.id);
      expect(depois).toEqual({ ...antes, price_kz: 12000 });
    });
  });

  describe("GET /offers", () => {
    it("lista só as próprias ofertas, ordenadas por especialidade (nome), método e duração", async () => {
      const pro = await h.newProfessional();
      const beta = await linkedSpecialty(pro.professionalId, `Beta ${randomUUID()}`);
      const alfa = await linkedSpecialty(pro.professionalId, `Alfa ${randomUUID()}`);
      const betaIn = await createOffer(pro.token, offerBody(beta, { method: "IN_PERSON", durationMinutes: 30 })).expect(201);
      const alfaVideo = await createOffer(pro.token, offerBody(alfa, { method: "VIDEO", durationMinutes: 15 })).expect(201);
      const alfaChat60 = await createOffer(pro.token, offerBody(alfa, { method: "CHAT", durationMinutes: 60 })).expect(201);
      const alfaChat15 = await createOffer(pro.token, offerBody(alfa, { method: "CHAT", durationMinutes: 15 })).expect(201);

      // Oferta de outro profissional: nunca aparece.
      const outro = await h.newProfessional();
      const specOutro = await linkedSpecialty(outro.professionalId);
      await createOffer(outro.token, offerBody(specOutro)).expect(201);

      const res = await listOffers(pro.token).expect(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      // Ordem do enum `offer_method` (IN_PERSON, VIDEO, CHAT, PHONE), depois a duração.
      expect(idsOf(res)).toEqual([alfaVideo.body.id, alfaChat15.body.id, alfaChat60.body.id, betaIn.body.id]);
    });

    it("filtro active=true e active=false", async () => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const ativa = await createOffer(pro.token, offerBody(spec, { method: "VIDEO" })).expect(201);
      const inativa = await createOffer(pro.token, offerBody(spec, { method: "PHONE" })).expect(201);
      await patchOffer(pro.token, inativa.body.id, { active: false }).expect(200);

      const apenasAtivas = await listOffers(pro.token, "?active=true").expect(200);
      expect(idsOf(apenasAtivas)).toEqual([ativa.body.id]);
      const apenasInativas = await listOffers(pro.token, "?active=false").expect(200);
      expect(idsOf(apenasInativas)).toEqual([inativa.body.id]);
    });

    it("active=lixo -> 400 ou 422 (validador)", async () => {
      const pro = await h.newProfessional();
      const res = await listOffers(pro.token, "?active=talvez");
      expect([400, 422]).toContain(res.status);
      // errors.md: parâmetro de query inválido ⇒ MALFORMED_REQUEST (convenção da plataforma, não VALIDATION_ERROR).
      expect(res.body.code).toBe("MALFORMED_REQUEST");
    });
  });

  // ---------------------------------------------------------------- (5) matriz estado × operação

  interface Operation {
    title: string;
    /** Operação de escrita: POST cria; PATCH altera o preço da oferta pré-criada em DRAFT. */
    kind: "create" | "patch";
    auditOperation: "CREATE_OFFER" | "UPDATE_OFFER";
  }
  const OPERATIONS: readonly Operation[] = [
    { title: "POST /offers", kind: "create", auditOperation: "CREATE_OFFER" },
    { title: "PATCH /offers/:id (preço)", kind: "patch", auditOperation: "UPDATE_OFFER" },
  ];
  const MATRIX = ESTADOS.flatMap((state) => OPERATIONS.map((operation) => ({ title: `${operation.title} em ${state}`, state, operation })));

  describe("matriz estado × operação (authorization.md §10.2)", () => {
    it.each(MATRIX)("$title", async ({ state, operation }) => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const existente = await createOffer(pro.token, offerBody(spec)).expect(201);
      await setState(pro.professionalId, state, state === "REJECTED" || state === "SUSPENDED" ? "Motivo do admin." : null);
      const antes = await offersOf(pro.professionalId);
      const denialsBefore = await accessDeniedCount(pro.accountId);

      const res =
        operation.kind === "create"
          ? await createOffer(pro.token, offerBody(spec, { method: "VIDEO", priceKz: 4321 }))
          : await patchOffer(pro.token, existente.body.id, { priceKz: 4321 });

      if (OFFERS_OK.includes(state)) {
        expect(res.status).toBe(operation.kind === "create" ? 201 : 200);
        expect(await offersOf(pro.professionalId)).not.toEqual(antes);
        expect(await accessDeniedCount(pro.accountId)).toBe(denialsBefore);
      } else {
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("PROFESSIONAL_LOCKED");
        expect(await offersOf(pro.professionalId)).toEqual(antes);
        // Negação auditada (ACCESS_DENIED / DENIED) com a operação, sem preço.
        expect(await accessDeniedCount(pro.accountId)).toBe(denialsBefore + 1);
        const { rows } = await h.pool.query<{ result: string; actor_type: string; metadata: { operation: string } }>(
          "SELECT result, actor_type, metadata FROM audit_logs WHERE action = 'ACCESS_DENIED' AND actor_professional_account_id = $1 ORDER BY id DESC LIMIT 1",
          [pro.accountId],
        );
        expect(rows[0]).toMatchObject({ result: "DENIED", actor_type: "PROFESSIONAL_ACCOUNT", metadata: { operation: operation.auditOperation } });
      }
    });

    it.each(ESTADOS)("GET /offers continua 200 no estado %s", async (state) => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      await createOffer(pro.token, offerBody(spec)).expect(201);
      await setState(pro.professionalId, state, state === "REJECTED" || state === "SUSPENDED" ? "Motivo do admin." : null);
      const res = await listOffers(pro.token).expect(200);
      expect(res.body).toHaveLength(1);
    });

    it.each(["REJECTED", "SUSPENDED"] as const)("PATCH de oferta ALHEIA em %s -> 404 (não PROFESSIONAL_LOCKED), sem auditoria de negação", async (state) => {
      const dono = await h.newProfessional();
      const intruso = await h.newProfessional();
      const spec = await linkedSpecialty(dono.professionalId);
      const alheia = await createOffer(dono.token, offerBody(spec)).expect(201);
      await setState(intruso.professionalId, state, "Motivo do admin.");
      const denialsBefore = await accessDeniedCount(intruso.accountId);
      const res = await patchOffer(intruso.token, alheia.body.id, { priceKz: 1 }).expect(404);
      expect(res.body.code).toBe("NOT_FOUND");
      expect(await accessDeniedCount(intruso.accountId)).toBe(denialsBefore);
    });
  });

  // ---------------------------------------------------------------- (6) auditoria sem preços nem notas

  describe("auditoria (audit.md §3): sem preço nem nota", () => {
    const CANARIO_PRECO = 987654;
    const CANARIO_NOTA = "nota-canario-morada-xyz";

    it("PROFESSIONAL_OFFER_CREATE e _UPDATE com actor PROFESSIONAL_ACCOUNT e metadata sem preço nem nota", async () => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const criada = await createOffer(pro.token, offerBody(spec, { priceKz: CANARIO_PRECO, note: CANARIO_NOTA })).expect(201);
      await patchOffer(pro.token, criada.body.id, { priceKz: CANARIO_PRECO + 1, note: CANARIO_NOTA + "-2" }).expect(200);

      const { rows } = await h.pool.query<{ action: string; actor_type: string; actor_professional_account_id: string; resource_type: string; resource_id: string; result: string; metadata: Record<string, unknown>; row: string }>(
        `SELECT action, actor_type, actor_professional_account_id, resource_type, resource_id, result, metadata, row_to_json(audit_logs)::text AS row
           FROM audit_logs WHERE action IN ('PROFESSIONAL_OFFER_CREATE', 'PROFESSIONAL_OFFER_UPDATE') AND resource_id = $1 ORDER BY id`,
        [criada.body.id],
      );
      expect(rows.map((r) => r.action)).toEqual(["PROFESSIONAL_OFFER_CREATE", "PROFESSIONAL_OFFER_UPDATE"]);
      for (const row of rows) {
        expect(row).toMatchObject({ actor_type: "PROFESSIONAL_ACCOUNT", actor_professional_account_id: pro.accountId, resource_type: "ProfessionalOffer", result: "SUCCESS" });
        const metadata = JSON.stringify(row.metadata);
        expect(metadata).not.toContain(String(CANARIO_PRECO));
        expect(metadata).not.toContain(CANARIO_NOTA);
        expect(row.row).not.toContain(CANARIO_NOTA);
        expect(row.row).not.toContain(String(CANARIO_PRECO));
      }
      expect(rows[1]?.metadata).toMatchObject({ fields: "priceKz,note", active: true });
    });
  });

  // ---------------------------------------------------------------- (7) isolamento (TC-AZ-MKT)

  describe("isolamento entre profissionais e tokens de outros atores (TC-AZ-MKT-01/03)", () => {
    it("operações de A não afetam ofertas de B (verificado na BD)", async () => {
      const a = await h.newProfessional();
      const b = await h.newProfessional();
      const specB = await linkedSpecialty(b.professionalId);
      const ofertaB = await createOffer(b.token, offerBody(specB)).expect(201);
      const antesB = await offersOf(b.professionalId);

      // A cria, lista, altera e desativa as suas; tenta mexer na de B.
      const specA = await linkedSpecialty(a.professionalId);
      const ofertaA = await createOffer(a.token, offerBody(specA)).expect(201);
      const listaA = await listOffers(a.token).expect(200);
      expect(idsOf(listaA)).toEqual([String(ofertaA.body.id)]);
      await patchOffer(a.token, ofertaA.body.id, { active: false, priceKz: 1 }).expect(200);
      await patchOffer(a.token, ofertaB.body.id, { active: false, priceKz: 1 }).expect(404);
      await createOffer(a.token, offerBody(specB, { method: "VIDEO" })).expect(422);

      expect(await offersOf(b.professionalId)).toEqual(antesB);
      expect((await offerRow(ofertaB.body.id))?.price_kz).toBe(5000);
      expect(await countOffers(a.professionalId, true)).toBe(0);
    });

    it.each([
      ["User", () => h.userToken()],
      ["ClinicAccount", () => h.clinicToken()],
      ["sem token", () => Promise.resolve(undefined)],
    ])("token de %s em GET, POST e PATCH -> 401", async (_ator, tokenOf) => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const criada = await createOffer(pro.token, offerBody(spec)).expect(201);
      const token = await tokenOf();
      const antes = await offersOf(pro.professionalId);
      const semToken = (r: request.Test) => (token ? r.set("Authorization", `Bearer ${token}`) : r);

      const get = await semToken(request(h.app).get(OFFERS));
      const post = await semToken(request(h.app).post(OFFERS)).send(offerBody(spec, { method: "PHONE" }));
      const criadaId = String(criada.body.id);
      const patch = await semToken(request(h.app).patch(`${OFFERS}/${criadaId}`)).send({ priceKz: 1 });

      expect([get.status, post.status, patch.status]).toEqual([401, 401, 401]);
      expect(await offersOf(pro.professionalId)).toEqual(antes);
    });
  });

  // ---------------------------------------------------------------- (8) BR-MKT-31: Kwanza inteiro

  describe("BR-MKT-31 / TC-MKT-37: preços em Kz inteiros", () => {
    it("priceKz '10.50' (string) e 10.5 (número) são recusados com 422", async () => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const comoTexto = await createOffer(pro.token, offerBody(spec, { priceKz: "10.50" })).expect(422);
      const comoNumero = await createOffer(pro.token, offerBody(spec, { priceKz: 10.5 })).expect(422);
      expect(comoTexto.body.code).toBe("VALIDATION_ERROR");
      expect(comoNumero.body.code).toBe("VALIDATION_ERROR");
      expect(await countOffers(pro.professionalId)).toBe(0);
    });

    it("preço decimal no PATCH -> 422 e preço inalterado", async () => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const criada = await createOffer(pro.token, offerBody(spec, { priceKz: 800 })).expect(201);
      await patchOffer(pro.token, criada.body.id, { priceKz: 10.5 }).expect(422);
      await patchOffer(pro.token, criada.body.id, { priceKz: "10.50" }).expect(422);
      expect((await offerRow(criada.body.id))?.price_kz).toBe(800);
    });

    it("a resposta devolve o preço como inteiro", async () => {
      const pro = await h.newProfessional();
      const spec = await linkedSpecialty(pro.professionalId);
      const criada = await createOffer(pro.token, offerBody(spec, { priceKz: 1500 })).expect(201);
      expect(Number.isInteger(criada.body.priceKz)).toBe(true);
      expect(criada.body.priceKz).toBe(1500);
      const lista = await listOffers(pro.token).expect(200);
      expect(Number.isInteger(lista.body[0].priceKz)).toBe(true);
    });
  });
});
