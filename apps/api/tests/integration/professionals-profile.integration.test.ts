/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- respostas HTTP/linhas SQL de teste sem tipagem (supertest devolve `any`). */
// Integração (PostgreSQL real + API real validada contra o openapi.yaml, pedidos E respostas) do perfil, das especialidades e da
// submissão do profissional (MK1 S5): TC-AZ-MKT-02 (matriz estado × operação, authorization.md §10.2), TC-MKT-07/21/22 (ver nota no
// relatório sobre a numeração em test-cases.md), BR-MKT-15/16/22/23/26, UC-MKT-03/05/12. Cada teste cria o seu profissional.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROFESSIONAL_API, startProfessionalsHarness, type ProfessionalsHarness } from "../support/professionals-harness.js";

const ME = `${PROFESSIONAL_API}/me`;
const SPECIALTIES = `${PROFESSIONAL_API}/me/specialties`;
const SUBMISSION = `${PROFESSIONAL_API}/submission`;

type Status = "DRAFT" | "PENDING_REVIEW" | "NEEDS_INFO" | "APPROVED" | "REJECTED" | "SUSPENDED";
type Category = "HEALTH" | "WELLNESS";
type CredentialKind = "IDENTITY" | "PROFESSIONAL_LICENSE" | "CERTIFICATION";
type ScanStatus = "PENDING" | "CLEAN" | "INFECTED";

const ESTADOS: readonly Status[] = ["DRAFT", "PENDING_REVIEW", "NEEDS_INFO", "APPROVED", "REJECTED", "SUSPENDED"];
/** BR-MKT-23 / authorization.md §10.2. */
const IDENTITY_OK: readonly Status[] = ["DRAFT", "NEEDS_INFO"];
const FREE_OK: readonly Status[] = ["DRAFT", "PENDING_REVIEW", "NEEDS_INFO", "APPROVED"];

describe("integração: perfil, especialidades e submissão do profissional (MK1 S5)", () => {
  let h: ProfessionalsHarness;

  beforeAll(async () => {
    h = await startProfessionalsHarness();
  });
  afterAll(async () => {
    await h.stop();
  });

  // ---------------------------------------------------------------- helpers locais

  /** Força o estado de validação por SQL (contorna a máquina de estados de propósito: é pré-condição de teste). */
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

  /** Cria uma especialidade e liga-a ao profissional; devolve o id da especialidade. */
  async function addSpecialty(professionalId: string, category: Category): Promise<string> {
    const id = await insertSpecialty(category);
    await h.pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1, $2)", [professionalId, id]);
    return id;
  }

  /** Credencial com ficheiro de 100 bytes em PDF; `storage_key` único. */
  async function addCredential(
    professionalId: string,
    kind: CredentialKind,
    options: { scanStatus: ScanStatus; validUntil?: string | null },
  ): Promise<string> {
    const { rows } = await h.pool.query<{ id: string }>(
      `INSERT INTO professional_credentials (professional_id, kind, valid_until, storage_key, content_type, size_bytes, scan_status)
       VALUES ($1, $2, $3, $4, 'application/pdf', 100, $5) RETURNING id`,
      [professionalId, kind, options.validUntil ?? null, `prof-cred/${randomUUID()}`, options.scanStatus],
    );
    return rows[0]?.id ?? "";
  }

  /** Snapshot do que uma escrita de perfil/especialidades/submissão pode alterar (auditoria só das ações de mutação). */
  async function snapshot(professionalId: string) {
    const profile = await h.pool.query(
      `SELECT display_name, bio, city, payment_instructions, validation_status, status_reason, submitted_at, approved_at, updated_at
         FROM professionals WHERE id = $1`,
      [professionalId],
    );
    const specialties = await h.pool.query("SELECT specialty_id FROM professional_specialties WHERE professional_id = $1 ORDER BY specialty_id", [professionalId]);
    const cases = await h.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM validation_cases WHERE professional_id = $1", [professionalId]);
    const audits = await h.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_logs WHERE resource_id = $1 AND action IN ('PROFESSIONAL_PROFILE_UPDATE', 'PROFESSIONAL_SPECIALTIES_SET', 'PROFESSIONAL_SUBMIT')",
      [professionalId],
    );
    return { profile: profile.rows[0], specialties: specialties.rows, cases: cases.rows[0]?.n, mutationAudits: audits.rows[0]?.n };
  }

  const getMe = (token: string) => request(h.app).get(ME).set("Authorization", `Bearer ${token}`);
  const patchMe = (token: string, body: unknown) => request(h.app).patch(ME).set("Authorization", `Bearer ${token}`).send(body as object);
  const putSpecialties = (token: string, specialtyIds: unknown) => request(h.app).put(SPECIALTIES).set("Authorization", `Bearer ${token}`).send({ specialtyIds });
  const submit = (token: string) => request(h.app).post(SUBMISSION).set("Authorization", `Bearer ${token}`);

  /** Profissional com perfil completo para submeter (HEALTH: identidade + cédula, válidas). */
  async function readyProfessional() {
    const pro = await h.newProfessional();
    await patchMe(pro.token, { displayName: "Ana Pronta", city: "Luanda" }).expect(200);
    await addSpecialty(pro.professionalId, "HEALTH");
    await addCredential(pro.professionalId, "IDENTITY", { scanStatus: "CLEAN" });
    await addCredential(pro.professionalId, "PROFESSIONAL_LICENSE", { scanStatus: "CLEAN", validUntil: "2027-12-31" });
    return pro;
  }

  /** Mensagens de `errors[]` de uma resposta 422 de submissão. */
  const requirementMessages = (body: { errors?: { message: string }[] }) => (body.errors ?? []).map((e) => e.message);

  // ---------------------------------------------------------------- (b) GET /me

  describe("GET /me (leitura sempre permitida)", () => {
    it("em DRAFT: 200, requisitos em falta, email próprio, sem especialidades e sem campos extra nem hash", async () => {
      const pro = await h.newProfessional();
      const res = await getMe(pro.token).expect(200);
      expect(res.body).toEqual({
        id: pro.professionalId,
        email: pro.email,
        displayName: null,
        bio: null,
        city: null,
        paymentInstructions: null,
        validationStatus: "DRAFT",
        statusReason: null,
        statusChangedAt: expect.any(String),
        submittedAt: null,
        approvedAt: null,
        specialties: [],
        requirements: { canSubmit: false, missing: ["DISPLAY_NAME", "CITY", "SPECIALTY"] },
      });
      expect(JSON.stringify(res.body)).not.toContain("passwordHash");
      expect(JSON.stringify(res.body)).not.toContain("password_hash");
    });

    it.each(ESTADOS)("funciona no estado %s (200, validationStatus e estado coerentes)", async (status) => {
      const pro = await h.newProfessional();
      await setState(pro.professionalId, status, status === "REJECTED" ? "Documentação insuficiente." : null);
      const res = await getMe(pro.token).expect(200);
      expect(res.body).toMatchObject({ id: pro.professionalId, email: pro.email, validationStatus: status });
      expect(res.body.requirements.canSubmit).toBe(false);
      expect(res.headers["cache-control"]).toBe("no-store");
    });

    it("token de User, token de clínica ou sem token ⇒ 401", async () => {
      const pro = await h.newProfessional();
      await getMe(await h.userToken()).expect(401);
      await getMe(await h.clinicToken()).expect(401);
      await request(h.app).get(ME).expect(401);
      expect(pro.professionalId).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------- (c) matriz TC-AZ-MKT-02

  interface Operation {
    title: string;
    allowed: readonly Status[];
    /** Resposta esperada quando a operação é permitida (a submissão sem requisitos é 422: passou o estado). */
    allowedStatus: number;
    blockedCode: "PROFESSIONAL_LOCKED" | "INVALID_STATE_TRANSITION";
    send: (token: string) => Promise<request.Response>;
  }

  const OPERATIONS: readonly Operation[] = [
    { title: "PATCH displayName", allowed: IDENTITY_OK, allowedStatus: 200, blockedCode: "PROFESSIONAL_LOCKED", send: (t) => patchMe(t, { displayName: "Nome Matriz" }) },
    { title: "PATCH bio", allowed: FREE_OK, allowedStatus: 200, blockedCode: "PROFESSIONAL_LOCKED", send: (t) => patchMe(t, { bio: "Bio matriz" }) },
    { title: "PATCH city", allowed: FREE_OK, allowedStatus: 200, blockedCode: "PROFESSIONAL_LOCKED", send: (t) => patchMe(t, { city: "Benguela" }) },
    {
      title: "PATCH paymentInstructions",
      allowed: FREE_OK,
      allowedStatus: 200,
      blockedCode: "PROFESSIONAL_LOCKED",
      send: (t) => patchMe(t, { paymentInstructions: "Pagamento matriz" }),
    },
    {
      title: "PUT /me/specialties",
      allowed: IDENTITY_OK,
      allowedStatus: 200,
      blockedCode: "PROFESSIONAL_LOCKED",
      send: async (t) => putSpecialties(t, [await insertSpecialty("HEALTH")]),
    },
    { title: "POST /submission", allowed: IDENTITY_OK, allowedStatus: 422, blockedCode: "INVALID_STATE_TRANSITION", send: (t) => submit(t) },
  ];

  const MATRIX = ESTADOS.flatMap((state) => OPERATIONS.map((operation) => ({ title: `${operation.title} em ${state}`, state, operation })));

  describe("matriz estado × operação (TC-AZ-MKT-02, authorization.md §10.2)", () => {
    it.each(MATRIX)("$title", async ({ state, operation }) => {
      const pro = await h.newProfessional();
      await setState(pro.professionalId, state, state === "REJECTED" || state === "SUSPENDED" ? "Motivo do admin." : null);
      const before = await snapshot(pro.professionalId);

      const res = await operation.send(pro.token);

      if (operation.allowed.includes(state)) {
        expect(res.status).toBe(operation.allowedStatus);
        if (operation.allowedStatus === 422) {
          // Submissão sem requisitos: falha de requisitos, nada escrito.
          expect(res.body.code).toBe("VALIDATION_ERROR");
          expect(await snapshot(pro.professionalId)).toEqual(before);
        }
      } else {
        expect(res.status).toBe(409);
        expect(res.body.code).toBe(operation.blockedCode);
        expect(await snapshot(pro.professionalId)).toEqual(before);
      }
    });

    it.each(ESTADOS)("leituras (GET /me) continuam 200 no estado %s", async (state) => {
      const pro = await h.newProfessional();
      await setState(pro.professionalId, state, state === "REJECTED" || state === "SUSPENDED" ? "Motivo do admin." : null);
      await getMe(pro.token).expect(200);
    });
  });

  // ---------------------------------------------------------------- (d) TC-MKT-07/21 validação do PATCH

  describe("validação do PATCH /me (limites de campos)", () => {
    it.each([
      ["displayName com 1 carácter", { displayName: "A" }],
      ["displayName com 121 caracteres", { displayName: "a".repeat(121) }],
      ["city com 1 carácter", { city: "L" }],
      ["city com 81 caracteres", { city: "c".repeat(81) }],
      ["bio com 1001 caracteres", { bio: "b".repeat(1001) }],
      ["paymentInstructions com 501 caracteres", { paymentInstructions: "p".repeat(501) }],
    ])("%s -> 422 VALIDATION_ERROR", async (_label, body) => {
      const pro = await h.newProfessional();
      const res = await patchMe(pro.token, body).expect(422);
      expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("corpo vazio {} -> 422", async () => {
      const pro = await h.newProfessional();
      await patchMe(pro.token, {}).expect(422);
    });

    it("campo desconhecido -> 422 (sozinho ou junto a campos válidos)", async () => {
      const pro = await h.newProfessional();
      await patchMe(pro.token, { role: "ADMIN" }).expect(422);
      await patchMe(pro.token, { displayName: "Ana Silva", email: "outro@exemplo.ao" }).expect(422);
      const { rows } = await h.pool.query("SELECT display_name FROM professionals WHERE id = $1", [pro.professionalId]);
      expect(rows[0]?.display_name).toBeNull();
    });

    it("limites exatos são aceites (nome 2 e 120, cidade 2 e 80, bio 1000, pagamento 500)", async () => {
      const pro = await h.newProfessional();
      const res = await patchMe(pro.token, {
        displayName: "An".padEnd(120, "a"),
        city: "Lu".padEnd(80, "a"),
        bio: "b".repeat(1000),
        paymentInstructions: "p".repeat(500),
      }).expect(200);
      expect(res.body).toMatchObject({ displayName: "An".padEnd(120, "a"), city: "Lu".padEnd(80, "a") });
      expect(res.body.bio).toHaveLength(1000);
      expect(res.body.paymentInstructions).toHaveLength(500);
      await patchMe(pro.token, { displayName: "Ab" }).expect(200);
    });

    it("valores são aparados; bio vazia (ou só espaços) passa a null", async () => {
      const pro = await h.newProfessional();
      const res = await patchMe(pro.token, { displayName: "  Ana Silva  ", city: "  Luanda  ", bio: "   " }).expect(200);
      expect(res.body).toMatchObject({ displayName: "Ana Silva", city: "Luanda", bio: null });
      const { rows } = await h.pool.query("SELECT display_name, city, bio FROM professionals WHERE id = $1", [pro.professionalId]);
      expect(rows[0]).toEqual({ display_name: "Ana Silva", city: "Luanda", bio: null });
    });

    it("bio '' passa a null e paymentInstructions '' também", async () => {
      const pro = await h.newProfessional();
      await patchMe(pro.token, { bio: "Uma bio" }).expect(200);
      const res = await patchMe(pro.token, { bio: "", paymentInstructions: "" }).expect(200);
      expect(res.body).toMatchObject({ bio: null, paymentInstructions: null });
    });

    it("auditoria PROFESSIONAL_PROFILE_UPDATE: metadata.fields só com os NOMES; nenhum valor enviado aparece na linha", async () => {
      const pro = await h.newProfessional();
      const canario = `canario-${randomUUID()}`;
      await patchMe(pro.token, {
        displayName: `Nome ${canario}`,
        bio: `Bio ${canario}`,
        paymentInstructions: `IBAN ${canario}`,
      }).expect(200);

      const { rows } = await h.pool.query<{ metadata: { fields: string }; row: string }>(
        `SELECT metadata, row_to_json(audit_logs)::text AS row FROM audit_logs
          WHERE action = 'PROFESSIONAL_PROFILE_UPDATE' AND resource_id = $1 ORDER BY id DESC LIMIT 1`,
        [pro.professionalId],
      );
      expect(rows[0]?.metadata).toEqual({ fields: "displayName,bio,paymentInstructions" });
      expect(rows[0]?.row).not.toContain(canario);
    });
  });

  // ---------------------------------------------------------------- (e) TC-MKT-21 especialidades

  describe("PUT /me/specialties (1–5 ativas, TC-MKT-21)", () => {
    it.each([
      ["0 identificadores", () => []],
      ["6 identificadores", () => Array.from({ length: 6 }, () => randomUUID())],
    ])("%s -> 422", async (_label, ids) => {
      const pro = await h.newProfessional();
      await putSpecialties(pro.token, ids()).expect(422);
    });

    it("identificadores repetidos -> 422", async () => {
      const pro = await h.newProfessional();
      const id = await insertSpecialty("HEALTH");
      await putSpecialties(pro.token, [id, id]).expect(422);
    });

    it("identificador inexistente -> 422", async () => {
      const pro = await h.newProfessional();
      await putSpecialties(pro.token, [randomUUID()]).expect(422);
    });

    it("especialidade inativa nova -> 422 e nada ligado", async () => {
      const pro = await h.newProfessional();
      const inativa = await insertSpecialty("WELLNESS", undefined, false);
      await putSpecialties(pro.token, [inativa]).expect(422);
      const { rows } = await h.pool.query("SELECT count(*)::int AS n FROM professional_specialties WHERE professional_id = $1", [pro.professionalId]);
      expect(rows[0]?.n).toBe(0);
    });

    it.each([1, 5])("%i especialidade(s) ativa(s) -> 200 e GET /me reflete-as ordenadas por nome", async (count) => {
      const pro = await h.newProfessional();
      const labels = ["Alfa", "Bravo", "Cabo", "Delta", "Eco"].slice(0, count);
      const ids: string[] = [];
      for (const label of labels) ids.push(await insertSpecialty("HEALTH", `${label} ${randomUUID()}`));

      const res = await putSpecialties(pro.token, [...ids].reverse()).expect(200);
      const names = (res.body.specialties as { name: string }[]).map((s) => s.name);
      expect(names).toHaveLength(count);
      expect(names.map((n) => n.split(" ")[0])).toEqual(labels);
      expect(names).toEqual([...names].sort());

      const me = await getMe(pro.token).expect(200);
      expect(me.body.specialties).toEqual(res.body.specialties);
    });

    it("substituir o conjunto: só ficam as novas ligações", async () => {
      const pro = await h.newProfessional();
      const a = await insertSpecialty("HEALTH");
      const b = await insertSpecialty("WELLNESS");
      const c = await insertSpecialty("HEALTH");
      await putSpecialties(pro.token, [a, b]).expect(200);
      const res = await putSpecialties(pro.token, [c]).expect(200);
      expect((res.body.specialties as { id: string }[]).map((s) => s.id)).toEqual([c]);
      const { rows } = await h.pool.query<{ specialty_id: string }>("SELECT specialty_id FROM professional_specialties WHERE professional_id = $1", [pro.professionalId]);
      expect(rows.map((r) => r.specialty_id)).toEqual([c]);
    });

    it("ligação a especialidade entretanto desativada mantém-se (e pode ser retirada sem ofertas)", async () => {
      const pro = await h.newProfessional();
      const a = await insertSpecialty("HEALTH");
      const b = await insertSpecialty("HEALTH");
      await putSpecialties(pro.token, [a, b]).expect(200);
      await h.pool.query("UPDATE specialties SET active = false WHERE id = $1", [a]);

      const keep = await putSpecialties(pro.token, [a, b]).expect(200);
      expect((keep.body.specialties as { id: string; active?: boolean }[]).map((s) => s.id)).toEqual(expect.arrayContaining([a, b]));
      await putSpecialties(pro.token, [a]).expect(200);
      await putSpecialties(pro.token, [b]).expect(200);
    });

    it("retirar uma especialidade com oferta ⇒ 409 CONFLICT e nada muda", async () => {
      const pro = await h.newProfessional();
      const a = await insertSpecialty("HEALTH");
      const b = await insertSpecialty("HEALTH");
      await putSpecialties(pro.token, [a, b]).expect(200);
      await h.pool.query(
        "INSERT INTO professional_offers (professional_id, specialty_id, method, duration_minutes, price_kz) VALUES ($1, $2, 'IN_PERSON', 30, 1000)",
        [pro.professionalId, a],
      );
      const before = await snapshot(pro.professionalId);

      const res = await putSpecialties(pro.token, [b]).expect(409);
      expect(res.body).toMatchObject({ code: "CONFLICT" });
      expect(await snapshot(pro.professionalId)).toEqual(before);
    });

    it("auditoria PROFESSIONAL_SPECIALTIES_SET com os ids ordenados", async () => {
      const pro = await h.newProfessional();
      const a = await insertSpecialty("HEALTH");
      const b = await insertSpecialty("WELLNESS");
      await putSpecialties(pro.token, [b, a]).expect(200);
      const { rows } = await h.pool.query<{ metadata: { specialtyIds: string } }>(
        "SELECT metadata FROM audit_logs WHERE action = 'PROFESSIONAL_SPECIALTIES_SET' AND resource_id = $1 ORDER BY id DESC LIMIT 1",
        [pro.professionalId],
      );
      expect(rows[0]?.metadata.specialtyIds).toBe([a, b].sort().join(","));
    });
  });

  // ---------------------------------------------------------------- (f) TC-MKT-07/22 submissão

  describe("POST /submission (TC-MKT-22)", () => {
    it("DRAFT sem nada ⇒ 422 com errors[] DISPLAY_NAME, CITY, SPECIALTY", async () => {
      const pro = await h.newProfessional();
      const res = await submit(pro.token).expect(422);
      expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
      expect(requirementMessages(res.body)).toEqual(["DISPLAY_NAME", "CITY", "SPECIALTY"]);
    });

    it("HEALTH sem credenciais ⇒ CREDENTIAL_IDENTITY e CREDENTIAL_PROFESSIONAL_LICENSE", async () => {
      const pro = await h.newProfessional();
      await patchMe(pro.token, { displayName: "Ana Silva", city: "Luanda" }).expect(200);
      await addSpecialty(pro.professionalId, "HEALTH");
      const res = await submit(pro.token).expect(422);
      expect(requirementMessages(res.body)).toEqual(["CREDENTIAL_IDENTITY", "CREDENTIAL_PROFESSIONAL_LICENSE"]);
    });

    it("WELLNESS exige IDENTITY + CERTIFICATION", async () => {
      const pro = await h.newProfessional();
      await patchMe(pro.token, { displayName: "Ana Silva", city: "Luanda" }).expect(200);
      await addSpecialty(pro.professionalId, "WELLNESS");
      const res = await submit(pro.token).expect(422);
      expect(requirementMessages(res.body)).toEqual(["CREDENTIAL_IDENTITY", "CREDENTIAL_CERTIFICATION"]);
    });

    it("mistura HEALTH + WELLNESS exige a união das credenciais", async () => {
      const pro = await h.newProfessional();
      await patchMe(pro.token, { displayName: "Ana Silva", city: "Luanda" }).expect(200);
      await addSpecialty(pro.professionalId, "HEALTH");
      await addSpecialty(pro.professionalId, "WELLNESS");
      const res = await submit(pro.token).expect(422);
      expect(requirementMessages(res.body)).toEqual(["CREDENTIAL_IDENTITY", "CREDENTIAL_PROFESSIONAL_LICENSE", "CREDENTIAL_CERTIFICATION"]);
    });

    it("credencial PENDING ⇒ CREDENTIAL_SCAN_PENDING", async () => {
      const pro = await readyProfessional();
      await h.pool.query("UPDATE professional_credentials SET scan_status = 'PENDING' WHERE professional_id = $1 AND kind = 'PROFESSIONAL_LICENSE'", [pro.professionalId]);
      const res = await submit(pro.token).expect(422);
      expect(requirementMessages(res.body)).toEqual(["CREDENTIAL_SCAN_PENDING"]);
    });

    it("credencial INFECTED ⇒ CREDENTIAL_INFECTED", async () => {
      const pro = await readyProfessional();
      await h.pool.query("UPDATE professional_credentials SET scan_status = 'INFECTED' WHERE professional_id = $1 AND kind = 'PROFESSIONAL_LICENSE'", [pro.professionalId]);
      const res = await submit(pro.token).expect(422);
      expect(requirementMessages(res.body)).toEqual(["CREDENTIAL_INFECTED"]);
    });

    it("credencial caducada ontem (Africa/Luanda) ⇒ CREDENTIAL_EXPIRED", async () => {
      const pro = await h.newProfessional();
      await patchMe(pro.token, { displayName: "Ana Silva", city: "Luanda" }).expect(200);
      await addSpecialty(pro.professionalId, "HEALTH");
      await addCredential(pro.professionalId, "IDENTITY", { scanStatus: "CLEAN" });
      await addCredential(pro.professionalId, "PROFESSIONAL_LICENSE", { scanStatus: "CLEAN", validUntil: "2026-11-15" });
      const res = await submit(pro.token).expect(422);
      expect(requirementMessages(res.body)).toEqual(["CREDENTIAL_EXPIRED"]);
    });

    it("valid_until = hoje (2026-11-16) é válida", async () => {
      const pro = await h.newProfessional();
      await patchMe(pro.token, { displayName: "Ana Silva", city: "Luanda" }).expect(200);
      await addSpecialty(pro.professionalId, "HEALTH");
      await addCredential(pro.professionalId, "IDENTITY", { scanStatus: "CLEAN" });
      await addCredential(pro.professionalId, "PROFESSIONAL_LICENSE", { scanStatus: "CLEAN", validUntil: "2026-11-16" });
      const res = await submit(pro.token).expect(200);
      expect(res.body).toMatchObject({ validationStatus: "PENDING_REVIEW" });
    });

    it("com tudo cumprido ⇒ 200 PENDING_REVIEW, submittedAt, canSubmit false, validation_case SUBMITTED e auditoria", async () => {
      const pro = await readyProfessional();
      const res = await submit(pro.token).expect(200);
      expect(res.body).toMatchObject({
        validationStatus: "PENDING_REVIEW",
        submittedAt: expect.any(String),
        requirements: { canSubmit: false, missing: [] },
      });

      const cases = await h.pool.query(
        "SELECT action, from_status, to_status, actor, decided_by, reason FROM validation_cases WHERE professional_id = $1",
        [pro.professionalId],
      );
      expect(cases.rows).toEqual([{ action: "SUBMITTED", from_status: "DRAFT", to_status: "PENDING_REVIEW", actor: "PROFESSIONAL", decided_by: null, reason: null }]);

      const audit = await h.pool.query<{ metadata: { toStatus: string } }>(
        "SELECT metadata FROM audit_logs WHERE action = 'PROFESSIONAL_SUBMIT' AND resource_id = $1 ORDER BY id DESC LIMIT 1",
        [pro.professionalId],
      );
      expect(audit.rows[0]?.metadata).toEqual({ toStatus: "PENDING_REVIEW" });
    });

    it("segunda submissão ⇒ 409 INVALID_STATE_TRANSITION, sem segundo validation_case", async () => {
      const pro = await readyProfessional();
      await submit(pro.token).expect(200);
      const res = await submit(pro.token).expect(409);
      expect(res.body).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
      const { rows } = await h.pool.query("SELECT count(*)::int AS n FROM validation_cases WHERE professional_id = $1", [pro.professionalId]);
      expect(rows[0]?.n).toBe(1);
    });

    it("NEEDS_INFO com requisitos cumpridos ⇒ volta a PENDING_REVIEW", async () => {
      const pro = await readyProfessional();
      await submit(pro.token).expect(200);
      await setState(pro.professionalId, "NEEDS_INFO", "Falta uma foto legível.");
      const res = await submit(pro.token).expect(200);
      expect(res.body).toMatchObject({ validationStatus: "PENDING_REVIEW", requirements: { canSubmit: false, missing: [] } });
      // O relógio do harness é fixo: `created_at` empata entre casos, por isso filtra-se pela transição em vez de ordenar.
      const { rows } = await h.pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM validation_cases WHERE professional_id = $1 AND action = 'SUBMITTED' AND from_status = 'NEEDS_INFO' AND to_status = 'PENDING_REVIEW' AND actor = 'PROFESSIONAL' AND decided_by IS NULL",
        [pro.professionalId],
      );
      expect(rows[0]?.n).toBe(1);
    });

    it("concorrência: dois POST /submission em paralelo ⇒ exatamente um 200 e um 409, um só validation_case", async () => {
      const pro = await readyProfessional();
      const [first, second] = await Promise.all([submit(pro.token), submit(pro.token)]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const losing = first.status === 409 ? first : second;
      expect(losing.body).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
      const { rows } = await h.pool.query("SELECT count(*)::int AS n FROM validation_cases WHERE professional_id = $1", [pro.professionalId]);
      expect(rows[0]?.n).toBe(1);
    });
  });

  // ---------------------------------------------------------------- isolamento

  describe("isolamento entre profissionais", () => {
    it("o PATCH e as especialidades de um profissional nunca alteram o outro", async () => {
      const a = await h.newProfessional();
      const b = await h.newProfessional();
      const bBefore = await snapshot(b.professionalId);
      const bSpecialty = await insertSpecialty("HEALTH");

      await patchMe(a.token, { displayName: "Só do A", city: "Huambo", bio: "Bio do A", paymentInstructions: "Pagamento do A" }).expect(200);
      await putSpecialties(a.token, [bSpecialty]).expect(200);

      expect(await snapshot(b.professionalId)).toEqual(bBefore);
      const meB = await getMe(b.token).expect(200);
      expect(meB.body).toMatchObject({ id: b.professionalId, displayName: null, city: null, bio: null, paymentInstructions: null, specialties: [] });
    });
  });

  describe("negações auditadas (authorization.md §10.1 passo 5)", () => {
    it("escrita recusada por PROFESSIONAL_LOCKED regista ACCESS_DENIED (DENIED) sem dados do pedido", async () => {
      const p = await h.newProfessional();
      await setState(p.professionalId, "REJECTED", "motivo");
      const before = await h.pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'ACCESS_DENIED' AND actor_professional_account_id = $1", [p.accountId]);
      await request(h.app).patch(`${PROFESSIONAL_API}/me`).set("Authorization", `Bearer ${p.token}`).send({ bio: "texto-canario-secreto" }).expect(409);
      const rows = await h.pool.query("SELECT result, actor_type, family_id, metadata FROM audit_logs WHERE action = 'ACCESS_DENIED' AND actor_professional_account_id = $1", [p.accountId]);
      expect(rows.rowCount).toBe(Number(before.rows[0].n) + 1);
      expect(rows.rows.at(-1)).toMatchObject({ result: "DENIED", actor_type: "PROFESSIONAL_ACCOUNT", family_id: null });
      expect(JSON.stringify(rows.rows)).not.toContain("canario");
    });
  });
});
