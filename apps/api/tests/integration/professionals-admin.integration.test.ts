/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- respostas HTTP/linhas SQL de teste sem tipagem (supertest devolve `any`). */
// Integração (PostgreSQL real + API real validada contra o openapi.yaml, pedidos E respostas) da validação pelo admin (MK1 S7):
// TC-MKT-11 (fila/detalhe), TC-MKT-12 (decisões), TC-MKT-13 (concorrência), TC-MKT-14 (imutabilidade e auditoria), download de
// credenciais pelo admin (UC-MKT-06, BR-MKT-17/18/27/28), TC-AZ-MKT-04 (autorização e inventário de rotas), TC-AZ-MKT-07 (sem saúde).
// Cada teste cria os seus profissionais; o admin é o `ADMIN_USER_ID` do harness (um só ficheiro, um só contentor).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openApiSpecPath } from "../support/openapi-spec.js";
import { ADMIN_USER_ID, API, INFECTED_MARKER, PROFESSIONAL_API, startProfessionalsHarness, type ProfessionalsHarness } from "../support/professionals-harness.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const ADMIN = `${API}/admin/professionals`;
const ME = `${PROFESSIONAL_API}/me`;
const SUBMISSION = `${PROFESSIONAL_API}/submission`;
const CREDENTIALS = `${PROFESSIONAL_API}/credentials`;

type Status = "DRAFT" | "PENDING_REVIEW" | "NEEDS_INFO" | "APPROVED" | "REJECTED" | "SUSPENDED";
type Decision = "APPROVE" | "REJECT" | "REQUEST_INFO" | "SUSPEND" | "REACTIVATE";
type Category = "HEALTH" | "WELLNESS";
type CredentialKind = "IDENTITY" | "PROFESSIONAL_LICENSE" | "CERTIFICATION";

const ESTADOS: readonly Status[] = ["DRAFT", "PENDING_REVIEW", "NEEDS_INFO", "APPROVED", "REJECTED", "SUSPENDED"];
const DECISIONS: readonly Decision[] = ["APPROVE", "REJECT", "REQUEST_INFO", "SUSPEND", "REACTIVATE"];

/** Transições válidas (state-machines.md «Professional», tabela de decisões do admin). Tudo o resto ⇒ 409. */
const VALID_TRANSITIONS: Record<string, Status> = {
  "PENDING_REVIEW:APPROVE": "APPROVED",
  "PENDING_REVIEW:REJECT": "REJECTED",
  "PENDING_REVIEW:REQUEST_INFO": "NEEDS_INFO",
  "APPROVED:REQUEST_INFO": "NEEDS_INFO",
  "APPROVED:SUSPEND": "SUSPENDED",
  "REJECTED:REQUEST_INFO": "NEEDS_INFO",
  "SUSPENDED:REACTIVATE": "APPROVED",
};

/** Ação de `validation_cases` por decisão. */
const CASE_ACTION: Record<Decision, string> = { APPROVE: "APPROVED", REJECT: "REJECTED", REQUEST_INFO: "NEEDS_INFO", SUSPEND: "SUSPENDED", REACTIVATE: "REACTIVATED" };
/** Ação de auditoria por decisão (ADMIN_PROFESSIONAL_*). */
const AUDIT_ACTION: Record<Decision, string> = {
  APPROVE: "ADMIN_PROFESSIONAL_APPROVE",
  REJECT: "ADMIN_PROFESSIONAL_REJECT",
  REQUEST_INFO: "ADMIN_PROFESSIONAL_REQUEST_INFO",
  SUSPEND: "ADMIN_PROFESSIONAL_SUSPEND",
  REACTIVATE: "ADMIN_PROFESSIONAL_REACTIVATE",
};
/** Decisões que exigem `reason` (BR-MKT-18). */
const REASON_REQUIRED: readonly Decision[] = ["REJECT", "REQUEST_INFO", "SUSPEND"];

/** Chaves que nunca podem sair em `/admin/professionals*` (TC-AZ-MKT-07; PT/EN conforme o contrato). */
const FORBIDDEN_KEYS = [
  "familyId",
  "memberId",
  "allergies",
  "conditions",
  "bloodType",
  "prescriptions",
  "medications",
  "appointments",
  "documents",
  "healthRecords",
  "paymentInstructions",
  "passwordHash",
  "tokenHash",
  "refreshToken",
] as const;

/** Chaves de segredo ou de pagamento (TC-MKT-11): nenhuma pode aparecer em lista nem detalhe. */
const SECRET_KEY = /token|refresh|password|storage|payment|hash/i;

const tok = (): string => `zq${randomUUID().replace(/-/g, "").slice(0, 12)}`;

/** Parser binário para supertest (`application/octet-stream` chega como Buffer). */
const binaryParser = (res: NodeJS.ReadableStream & { headers: Record<string, string | undefined> }, callback: (err: Error | null, body: unknown) => void): void => {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => {
    const body = Buffer.concat(chunks);
    if (res.headers["content-type"]?.includes("json")) {
      callback(null, JSON.parse(body.toString("utf8")) as unknown);
      return;
    }
    callback(null, body);
  });
};

/** Todas as chaves de um valor JSON, em profundidade. */
function keysOf(value: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) keysOf(v, acc);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      acc.add(k);
      keysOf(v, acc);
    }
  }
  return acc;
}

/** Mapa `caminho → métodos` lido do openapi.yaml com regex (não há parser de YAML no repo). */
function openApiPaths(): Map<string, string[]> {
  const lines = readFileSync(openApiSpecPath(REPO_ROOT), "utf8").split("\n");
  const start = lines.indexOf("paths:");
  const result = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const pathMatch = /^ {2}(\/\S*):\s*$/.exec(line);
    if (pathMatch?.[1]) {
      current = pathMatch[1];
      result.set(current, []);
      continue;
    }
    const methodMatch = /^ {4}(get|put|post|delete|patch|options|head|trace):\s*$/.exec(line);
    if (methodMatch?.[1] && current) result.get(current)?.push(methodMatch[1]);
  }
  return result;
}

describe("integração: validação pelo admin (MK1 S7)", () => {
  let h: ProfessionalsHarness;
  let admin: string;

  beforeAll(async () => {
    h = await startProfessionalsHarness();
    admin = await h.adminToken();
  });
  beforeEach(async () => {
    // O relógio do harness avança entre testes e o token tem TTL de 900 s: assina-se um novo por teste.
    admin = await h.adminToken();
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

  async function addSpecialty(professionalId: string, category: Category, name = `Especialidade ${randomUUID()}`): Promise<string> {
    const { rows } = await h.pool.query<{ id: string }>("INSERT INTO specialties (name, category, active) VALUES ($1, $2, true) RETURNING id", [name, category]);
    const id = rows[0]?.id ?? "";
    await h.pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1, $2)", [professionalId, id]);
    return id;
  }

  /** Credencial inserida por SQL com `storage_key` único (metadados e estado de scan à escolha). */
  async function addCredential(
    professionalId: string,
    kind: CredentialKind,
    options: { scanStatus: "PENDING" | "CLEAN" | "INFECTED"; validUntil?: string | null; number?: string | null },
  ): Promise<string> {
    const { rows } = await h.pool.query<{ id: string }>(
      `INSERT INTO professional_credentials (professional_id, kind, number, valid_until, storage_key, content_type, size_bytes, scan_status)
       VALUES ($1, $2, $3, $4, $5, 'application/pdf', 100, $6) RETURNING id`,
      [professionalId, kind, options.number ?? null, options.validUntil ?? null, `prof-cred/${randomUUID()}`, options.scanStatus],
    );
    return rows[0]?.id ?? "";
  }

  const getMe = (token: string) => request(h.app).get(ME).set("Authorization", `Bearer ${token}`);
  const patchMe = (token: string, body: object) => request(h.app).patch(ME).set("Authorization", `Bearer ${token}`).send(body);
  const submitAsPro = (token: string) => request(h.app).post(SUBMISSION).set("Authorization", `Bearer ${token}`);

  /** Profissional com perfil completo para aprovar (HEALTH: identidade + cédula CLEAN, válidas). DRAFT. */
  async function readyProfessional(email?: string) {
    const pro = await h.newProfessional(email);
    await patchMe(pro.token, { displayName: `Pronta ${tok()}`, city: "Luanda" }).expect(200);
    await addSpecialty(pro.professionalId, "HEALTH");
    await addCredential(pro.professionalId, "IDENTITY", { scanStatus: "CLEAN" });
    await addCredential(pro.professionalId, "PROFESSIONAL_LICENSE", { scanStatus: "CLEAN", validUntil: "2027-12-31" });
    return pro;
  }

  /**
   * Profissional em PENDING_REVIEW para a fila. `ago` (intervalo SQL) ou `at` (timestamp literal) fixam `submitted_at`; por omissão
   * `now()` (com micro-segundos, como em produção).
   */
  async function pending(opts: { name?: string; email?: string; ago?: string; at?: string; specialty?: Category; credential?: boolean } = {}) {
    const pro = await h.newProfessional(opts.email);
    if (opts.name) await h.pool.query("UPDATE professionals SET display_name = $2 WHERE id = $1", [pro.professionalId, opts.name]);
    if (opts.specialty) await addSpecialty(pro.professionalId, opts.specialty);
    if (opts.credential) await addCredential(pro.professionalId, "IDENTITY", { scanStatus: "CLEAN" });
    await setState(pro.professionalId, "PENDING_REVIEW");
    if (opts.ago) await h.pool.query("UPDATE professionals SET submitted_at = now() - $2::interval WHERE id = $1", [pro.professionalId, opts.ago]);
    if (opts.at) await h.pool.query("UPDATE professionals SET submitted_at = $2::timestamptz WHERE id = $1", [pro.professionalId, opts.at]);
    return pro;
  }

  const list = (query: Record<string, string | number> = {}) => request(h.app).get(ADMIN).query(query).set("Authorization", `Bearer ${admin}`);
  const detail = (id: string, token = admin) => request(h.app).get(`${ADMIN}/${id}`).set("Authorization", `Bearer ${token}`);
  const decide = (id: string, body: object | undefined, token = admin) => {
    const req = request(h.app).post(`${ADMIN}/${id}/decisions`).set("Authorization", `Bearer ${token}`);
    return body === undefined ? req : req.send(body);
  };
  const downloadCredential = (professionalId: string, credentialId: string, token = admin) =>
    request(h.app).get(`${ADMIN}/${professionalId}/credentials/${credentialId}/file`).set("Authorization", `Bearer ${token}`).buffer(true).parse(binaryParser);

  /** Percorre a fila com `cursor` até `nextCursor` ser null; devolve os ids por ordem e o nº de páginas. */
  async function walk(query: Record<string, string | number>, limit: number): Promise<{ ids: string[]; pages: number; items: Record<string, unknown>[] }> {
    const ids: string[] = [];
    const items: Record<string, unknown>[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await list({ ...query, limit, ...(cursor ? { cursor } : {}) }).expect(200);
      pages += 1;
      const pageItems = res.body.items as Record<string, unknown>[];
      items.push(...pageItems);
      ids.push(...pageItems.map((i) => i.id as string));
      cursor = res.body.nextCursor as string | null;
      if (pages > 500) throw new Error("paginação não termina");
    } while (cursor);
    return { ids, pages, items };
  }

  /** Ordem SQL esperada da fila (PENDING_REVIEW por submitted_at, depois id). */
  async function sqlPendingOrder(): Promise<string[]> {
    const { rows } = await h.pool.query<{ id: string }>("SELECT id FROM professionals WHERE validation_status = 'PENDING_REVIEW' ORDER BY submitted_at ASC, id ASC");
    return rows.map((r) => r.id);
  }

  /** Estado observável de um profissional: linha completa, nº de validation_cases e nº de auditorias sobre o recurso. */
  async function stateOf(professionalId: string) {
    const row = await h.pool.query<{ row: string }>("SELECT row_to_json(p)::text AS row FROM professionals p WHERE id = $1", [professionalId]);
    const cases = await h.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM validation_cases WHERE professional_id = $1", [professionalId]);
    const audits = await h.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_logs WHERE resource_id = $1", [professionalId]);
    return { row: row.rows[0]?.row, cases: cases.rows[0]?.n, audits: audits.rows[0]?.n };
  }

  /** Avança o relógio de teste 1 minuto: `created_at` de `validation_cases` é único e a ordem de `history` fica determinística. */
  const step = (): void => {
    h.clock.advance(60_000);
  };

  async function caseRows(professionalId: string) {
    const { rows } = await h.pool.query<{ action: string; from_status: string; to_status: string; actor: string; decided_by: string | null; reason: string | null }>(
      "SELECT action, from_status, to_status, actor, decided_by, reason FROM validation_cases WHERE professional_id = $1 ORDER BY created_at ASC, id ASC",
      [professionalId],
    );
    return rows;
  }

  /** Corre o ciclo completo do admin e do profissional; devolve o id. */
  async function runCycle(): Promise<{ id: string; token: string }> {
    const pro = await readyProfessional();
    const id = pro.professionalId;
    await setState(id, "PENDING_REVIEW");
    step();
    await decide(id, { decision: "APPROVE" }).expect(200);
    step();
    await decide(id, { decision: "SUSPEND", reason: "Suspensão de teste." }).expect(200);
    step();
    await decide(id, { decision: "REACTIVATE" }).expect(200);
    step();
    await decide(id, { decision: "REQUEST_INFO", reason: "Falta uma foto legível." }).expect(200);
    step();
    await submitAsPro(pro.token).expect(200);
    step();
    await decide(id, { decision: "REJECT", reason: "Documentação insuficiente." }).expect(200);
    step();
    await decide(id, { decision: "REQUEST_INFO", reason: "Reenvie a cédula." }).expect(200);
    return { id, token: pro.token };
  }

  /** Estado com o qual a tabela de decisões começa: profissional completo, no estado pedido. */
  async function prepare(status: Status): Promise<string> {
    const pro = await readyProfessional();
    const reason = status === "REJECTED" || status === "SUSPENDED" || status === "NEEDS_INFO" ? "Motivo anterior." : null;
    await setState(pro.professionalId, status, reason);
    return pro.professionalId;
  }

  /** Corpo de decisão com motivo quando a decisão o exige (APPROVE/REACTIVATE não levam motivo). */
  const bodyFor = (decision: Decision, reason = "Motivo da tabela de decisões."): { decision: Decision; reason?: string } =>
    REASON_REQUIRED.includes(decision) ? { decision, reason } : { decision };

  // ---------------------------------------------------------------- (1) TC-MKT-11 fila e detalhe

  describe("(1) TC-MKT-11 fila e detalhe", () => {
    it("omissão = PENDING_REVIEW em FIFO por submittedAt ascendente; os outros estados não aparecem; forma do item", async () => {
      const t = tok();
      const a = await pending({ name: `Fila A ${t}`, ago: "3 days" });
      const b = await pending({ name: `Fila B ${t}`, ago: "2 days" });
      const c = await pending({ name: `Fila C ${t}`, ago: "1 day", credential: true });
      const draft = await h.newProfessional();
      const others: string[] = [draft.professionalId];
      for (const status of ["NEEDS_INFO", "APPROVED", "REJECTED", "SUSPENDED"] as const) {
        const p = await h.newProfessional();
        await setState(p.professionalId, status, "motivo");
        others.push(p.professionalId);
      }

      const res = await list().expect(200);
      const ids = (res.body.items as { id: string }[]).map((i) => i.id);
      for (const o of others) expect(ids).not.toContain(o);
      expect((res.body.items as { validationStatus: string }[]).every((i) => i.validationStatus === "PENDING_REVIEW")).toBe(true);
      expect(ids.indexOf(a.professionalId)).toBeLessThan(ids.indexOf(b.professionalId));
      expect(ids.indexOf(b.professionalId)).toBeLessThan(ids.indexOf(c.professionalId));
      expect(ids).toEqual(await sqlPendingOrder());

      const item = (res.body.items as Record<string, unknown>[]).find((i) => i.id === c.professionalId);
      expect(Object.keys(item ?? {}).sort()).toEqual(["createdAt", "credentialCount", "displayName", "email", "id", "specialties", "submittedAt", "validationStatus"]);
      expect(item).toMatchObject({ displayName: `Fila C ${t}`, email: c.email, validationStatus: "PENDING_REVIEW", credentialCount: 1, specialties: [] });
      expect(typeof item?.submittedAt).toBe("string");
    });

    it.each(["DRAFT", "NEEDS_INFO", "APPROVED", "REJECTED", "SUSPENDED"] as const)("filtro status=%s só devolve esse estado e inclui o profissional", async (status) => {
      const p = await h.newProfessional();
      await setState(p.professionalId, status, status === "DRAFT" ? null : "motivo");
      const { items } = await walk({ status }, 100);
      expect(items.every((i) => i.validationStatus === status)).toBe(true);
      expect(items.map((i) => i.id)).toContain(p.professionalId);
    });

    it("status inválido ⇒ 400 MALFORMED_REQUEST (errors.md: parâmetro fora do contrato)", async () => {
      const res = await list({ status: "DELETE" }).expect(400);
      expect(res.body).toMatchObject({ code: "MALFORMED_REQUEST" });
    });

    it("category=HEALTH e category=WELLNESS só devolvem quem tem especialidade dessa categoria", async () => {
      const health = await pending({ specialty: "HEALTH" });
      const wellness = await pending({ specialty: "WELLNESS" });
      const both = await pending();
      await addSpecialty(both.professionalId, "HEALTH");
      await addSpecialty(both.professionalId, "WELLNESS");

      const h1 = (await walk({ category: "HEALTH" }, 100)).items;
      const w1 = (await walk({ category: "WELLNESS" }, 100)).items;
      const hIds = h1.map((i) => i.id);
      const wIds = w1.map((i) => i.id);
      expect(hIds).toContain(health.professionalId);
      expect(hIds).toContain(both.professionalId);
      expect(hIds).not.toContain(wellness.professionalId);
      expect(wIds).toContain(wellness.professionalId);
      expect(wIds).toContain(both.professionalId);
      expect(wIds).not.toContain(health.professionalId);
      for (const i of h1) expect((i.specialties as { category: string }[]).some((s) => s.category === "HEALTH")).toBe(true);
      for (const i of w1) expect((i.specialties as { category: string }[]).some((s) => s.category === "WELLNESS")).toBe(true);
    });

    it("category fora do enum ⇒ 400 MALFORMED_REQUEST", async () => {
      const res = await list({ category: "CARDIO" }).expect(400);
      expect(res.body).toMatchObject({ code: "MALFORMED_REQUEST" });
    });

    it("q pesquisa por parte do nome de apresentação e é case-insensitive", async () => {
      const t = tok();
      const p = await pending({ name: `Ana ${t} Silva` });
      const other = await pending({ name: `Outra ${tok()}` });
      for (const q of [t, t.toUpperCase(), `Ana ${t}`.toUpperCase()]) {
        const { ids } = await walk({ q }, 100);
        expect(ids).toContain(p.professionalId);
        expect(ids).not.toContain(other.professionalId);
      }
    });

    it("q pesquisa por parte do e-mail (case-insensitive)", async () => {
      const t = tok();
      const p = await pending({ email: `mail.${t}@exemplo.ao` });
      const other = await pending();
      const { ids } = await walk({ q: t.toUpperCase() }, 100);
      expect(ids).toContain(p.professionalId);
      expect(ids).not.toContain(other.professionalId);
    });

    it("q com 1 carácter ⇒ 400 MALFORMED_REQUEST (contrato: minLength 2)", async () => {
      const res = await list({ q: "a" }).expect(400);
      expect(res.body).toMatchObject({ code: "MALFORMED_REQUEST" });
    });

    it("q com '%' literal não funciona como wildcard", async () => {
      const t = tok();
      const literal = await pending({ name: `Desc 100% ${t}` });
      const lookalike = await pending({ name: `Desc 100X ${t}` });
      const { ids } = await walk({ q: "100%" }, 100);
      expect(ids).toContain(literal.professionalId);
      expect(ids).not.toContain(lookalike.professionalId);
    });

    it("q com '_' literal não funciona como wildcard", async () => {
      const t = tok();
      const literal = await pending({ name: `a_b ${t}` });
      const lookalike = await pending({ name: `aXb ${t}` });
      const { ids } = await walk({ q: "a_b" }, 100);
      expect(ids).toContain(literal.professionalId);
      expect(ids).not.toContain(lookalike.professionalId);
    });



    it("paginação por cursor com a página por omissão (25) sobre 27 itens: sem repetir nem saltar", async () => {
      // Datas fixas e antigas (2020) para que estes 27 sejam os primeiros da fila, com micro-segundos distintos e dois empatados.
      const base = "2020-01-01T00:00:00";
      const ids: string[] = [];
      for (let i = 0; i < 27; i += 1) {
        // Os dois primeiros empatam (mesmo instante); os restantes têm micro-segundos distintos e não nulos.
        const micro = i < 2 ? 1 : i;
        ids.push((await pending({ at: `${base}.${String(micro).padStart(6, "0")}Z` })).professionalId);
      }
      const expected = await sqlPendingOrder();
      const walked = await walk({}, 25);
      expect(walked.pages).toBe(Math.ceil(expected.length / 25));
      expect(new Set(walked.ids).size).toBe(walked.ids.length);
      expect(walked.ids).toEqual(expected);
      for (const id of ids) expect(walked.ids).toContain(id);
    });

    it("query limit é respeitada — limit=2 devolve no máximo 2 itens", async () => {
      await pending();
      await pending();
      await pending();
      const res = await list({ limit: 2 }).expect(200);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
    });

    it("cursor inválido devolve 400 MALFORMED_REQUEST (errors.md)", async () => {
      for (const cursor of ["lixo", "@@@", "bm90LXV1aWQ", Buffer.from("2026-11-01T00:00:00Z|nao-e-uuid").toString("base64url")]) {
        const res = await list({ cursor });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ code: "MALFORMED_REQUEST" });
      }
    });

    it("cada item tem credentialCount e specialties; detalhe com email, emailVerifiedAt, perfil, especialidades, credenciais e histórico", async () => {
      const t = tok();
      const pro = await pending({ name: `Detalhe ${t}`, specialty: "HEALTH" });
      await addCredential(pro.professionalId, "PROFESSIONAL_LICENSE", { scanStatus: "CLEAN", validUntil: "2027-01-31", number: "CED-1" });
      await addCredential(pro.professionalId, "IDENTITY", { scanStatus: "PENDING" });

      const res = await detail(pro.professionalId).expect(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body).toMatchObject({
        id: pro.professionalId,
        email: pro.email,
        emailVerifiedAt: expect.any(String),
        displayName: `Detalhe ${t}`,
        validationStatus: "PENDING_REVIEW",
        submittedAt: expect.any(String),
        specialties: [expect.objectContaining({ category: "HEALTH" })],
        history: [],
      });
      expect(res.body.credentials).toHaveLength(2);
      for (const c of res.body.credentials as Record<string, unknown>[]) {
        expect(Object.keys(c).sort()).toEqual(["contentType", "createdAt", "id", "issuingBody", "kind", "number", "scanStatus", "sizeBytes", "validUntil"]);
      }
      expect(res.body.credentials).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: "PROFESSIONAL_LICENSE", number: "CED-1", scanStatus: "CLEAN", validUntil: "2027-01-31" })]),
      );
    });

    it("detalhe devolve histórico mais recente primeiro", async () => {
      const pro = await pending();
      await decide(pro.professionalId, { decision: "REJECT", reason: "Primeiro motivo." }).expect(200);
      step();
      await decide(pro.professionalId, { decision: "REQUEST_INFO", reason: "Segundo motivo." }).expect(200);
      const res = await detail(pro.professionalId).expect(200);
      const history = res.body.history as { action: string; reason: string; createdAt: string }[];
      expect(history.map((x) => x.action)).toEqual(["NEEDS_INFO", "REJECTED"]);
      expect(history[0]?.reason).toBe("Segundo motivo.");
      expect(new Date(history[0]?.createdAt ?? 0).getTime()).toBeGreaterThan(new Date(history[1]?.createdAt ?? 0).getTime());
    });

    it("id inexistente ⇒ 404 no detalhe e na decisão", async () => {
      const missing = randomUUID();
      const res = await detail(missing).expect(404);
      expect(res.body).toMatchObject({ code: "NOT_FOUND" });
      await decide(missing, { decision: "APPROVE" }).expect(404);
    });

    it("JSON de lista e detalhe NÃO contém paymentInstructions, hashes, tokens, storageKey nem o valor do canário", async () => {
      const canario = `IBAN-CANARIO-${randomUUID()}`;
      const pro = await pending({ name: `Sem segredos ${tok()}`, specialty: "HEALTH", credential: true });
      await h.pool.query("UPDATE professionals SET payment_instructions = $2 WHERE id = $1", [pro.professionalId, canario]);

      const listRes = await list({ limit: 100 }).expect(200);
      const detailRes = await detail(pro.professionalId).expect(200);
      const serializedList = JSON.stringify(listRes.body);
      const serializedDetail = JSON.stringify(detailRes.body);

      for (const body of [listRes.body, detailRes.body]) {
        const keys = [...keysOf(body)];
        expect(keys.filter((k) => SECRET_KEY.test(k))).toEqual([]);
        expect(keys).not.toContain("storageKey");
        expect(keys).not.toContain("storage_key");
      }
      expect(serializedList).not.toContain(canario);
      expect(serializedDetail).not.toContain(canario);
      expect(serializedDetail).not.toContain("passwordHash");
      expect(serializedDetail).not.toContain("password_hash");
    });
  });

  // ---------------------------------------------------------------- (2) TC-MKT-12 decisões

  describe("(2) TC-MKT-12 decisões", () => {
    it.each(ESTADOS.flatMap((state) => DECISIONS.map((decision) => ({ state, decision }))))(
      "$state + $decision",
      async ({ state, decision }) => {
        const key = `${state}:${decision}`;
        const expectedTo = VALID_TRANSITIONS[key];
        const id = await prepare(state);
        const before = await stateOf(id);
        const body = bodyFor(decision);
        const res = await decide(id, body);

        if (expectedTo === undefined) {
          expect(res.status).toBe(409);
          expect(res.body).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
          expect(await stateOf(id)).toEqual(before);
          return;
        }
        const expectedReason = REASON_REQUIRED.includes(decision) ? "Motivo da tabela de decisões." : null;
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ id, validationStatus: expectedTo, statusReason: expectedReason });
        expect(res.body.history[0]).toMatchObject({ action: CASE_ACTION[decision], fromStatus: state, toStatus: expectedTo, actor: "PLATFORM_ADMIN", reason: expectedReason });
        const cases = await caseRows(id);
        expect(cases).toHaveLength(1);
        expect(cases[0]).toMatchObject({ decided_by: ADMIN_USER_ID, actor: "PLATFORM_ADMIN", from_status: state, to_status: expectedTo });
      },
    );

    it.each(DECISIONS.filter((d) => REASON_REQUIRED.includes(d)).map((d) => [d]))("%s sem reason ⇒ 422 VALIDATION_ERROR e nada muda", async (decision) => {
      const id = await prepare(decision === "SUSPEND" ? "APPROVED" : "PENDING_REVIEW");
      const before = await stateOf(id);
      const res = await decide(id, { decision });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
      expect(await stateOf(id)).toEqual(before);
    });

    it.each(DECISIONS.filter((d) => REASON_REQUIRED.includes(d)).map((d) => [d]))("%s com reason só de espaços ⇒ 422 e nada muda", async (decision) => {
      const id = await prepare(decision === "SUSPEND" ? "APPROVED" : "PENDING_REVIEW");
      const before = await stateOf(id);
      await decide(id, { decision, reason: "   " }).expect(422);
      expect(await stateOf(id)).toEqual(before);
    });

    it("reason vazio ('') ⇒ 422 (minLength do contrato)", async () => {
      const id = await prepare("PENDING_REVIEW");
      const before = await stateOf(id);
      await decide(id, { decision: "REJECT", reason: "" }).expect(422);
      expect(await stateOf(id)).toEqual(before);
    });

    it("reason com 501 caracteres ⇒ 422 e nada muda", async () => {
      const id = await prepare("PENDING_REVIEW");
      const before = await stateOf(id);
      await decide(id, { decision: "REJECT", reason: "r".repeat(501) }).expect(422);
      expect(await stateOf(id)).toEqual(before);
    });

    it("reason com 500 caracteres é aceite e fica igual no estado", async () => {
      const id = await prepare("PENDING_REVIEW");
      const res = await decide(id, { decision: "REJECT", reason: "r".repeat(500) }).expect(200);
      expect(res.body.statusReason).toHaveLength(500);
    });

    it("APPROVE sem credencial CLEAN ⇒ 422 com errors[] de requisitos e nada muda", async () => {
      const pro = await h.newProfessional();
      await patchMe(pro.token, { displayName: `Sem cred ${tok()}`, city: "Luanda" }).expect(200);
      await addSpecialty(pro.professionalId, "HEALTH");
      await setState(pro.professionalId, "PENDING_REVIEW");
      const before = await stateOf(pro.professionalId);
      const res = await decide(pro.professionalId, { decision: "APPROVE" }).expect(422);
      expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
      expect((res.body.errors as { message: string }[]).map((e) => e.message)).toEqual(["CREDENTIAL_IDENTITY", "CREDENTIAL_PROFESSIONAL_LICENSE"]);
      expect(await stateOf(pro.professionalId)).toEqual(before);
    });

    it("APPROVE com só a identidade (cédula em falta) ⇒ 422 só com CREDENTIAL_PROFESSIONAL_LICENSE", async () => {
      const pro = await h.newProfessional();
      await patchMe(pro.token, { displayName: `Sem cedula ${tok()}`, city: "Luanda" }).expect(200);
      await addSpecialty(pro.professionalId, "HEALTH");
      await addCredential(pro.professionalId, "IDENTITY", { scanStatus: "CLEAN" });
      await setState(pro.professionalId, "PENDING_REVIEW");
      const res = await decide(pro.professionalId, { decision: "APPROVE" }).expect(422);
      expect((res.body.errors as { message: string }[]).map((e) => e.message)).toEqual(["CREDENTIAL_PROFESSIONAL_LICENSE"]);
    });

    it("REACTIVATE sem credenciais ⇒ 422 com requisitos e nada muda", async () => {
      const pro = await h.newProfessional();
      await patchMe(pro.token, { displayName: `Sem reativar ${tok()}`, city: "Luanda" }).expect(200);
      await addSpecialty(pro.professionalId, "HEALTH");
      await setState(pro.professionalId, "SUSPENDED", "Suspenso.");
      const before = await stateOf(pro.professionalId);
      const res = await decide(pro.professionalId, { decision: "REACTIVATE" }).expect(422);
      expect((res.body.errors as { message: string }[]).map((e) => e.message)).toEqual(["CREDENTIAL_IDENTITY", "CREDENTIAL_PROFESSIONAL_LICENSE"]);
      expect(await stateOf(pro.professionalId)).toEqual(before);
    });

    it("APPROVE feliz: APPROVED, approved_at preenchido, statusReason null e ValidationCase com decided_by = admin", async () => {
      const pro = await readyProfessional();
      await setState(pro.professionalId, "PENDING_REVIEW");
      const res = await decide(pro.professionalId, { decision: "APPROVE" }).expect(200);
      expect(res.body).toMatchObject({ validationStatus: "APPROVED", statusReason: null, approvedAt: expect.any(String) });
      const { rows } = await h.pool.query<{ approved_at: Date | null; validation_status: string }>("SELECT approved_at, validation_status FROM professionals WHERE id = $1", [pro.professionalId]);
      expect(rows[0]?.validation_status).toBe("APPROVED");
      expect(rows[0]?.approved_at).not.toBeNull();
      expect(await caseRows(pro.professionalId)).toEqual([
        { action: "APPROVED", from_status: "PENDING_REVIEW", to_status: "APPROVED", actor: "PLATFORM_ADMIN", decided_by: ADMIN_USER_ID, reason: null },
      ]);
    });

    it("REACTIVATE com credencial entretanto caducada (valid_until ontem) ⇒ 422 CREDENTIAL_EXPIRED", async () => {
      const pro = await readyProfessional();
      await h.pool.query("UPDATE professional_credentials SET valid_until = '2026-11-15' WHERE professional_id = $1 AND kind = 'PROFESSIONAL_LICENSE'", [pro.professionalId]);
      await setState(pro.professionalId, "SUSPENDED", "Suspenso.");
      const before = await stateOf(pro.professionalId);
      const res = await decide(pro.professionalId, { decision: "REACTIVATE" }).expect(422);
      expect((res.body.errors as { message: string }[]).map((e) => e.message)).toEqual(["CREDENTIAL_EXPIRED"]);
      expect(await stateOf(pro.professionalId)).toEqual(before);
    });

    it("decisão fora do enum ('DELETE') ⇒ 422 ou 400 e nada muda", async () => {
      const id = await prepare("PENDING_REVIEW");
      const before = await stateOf(id);
      const res = await decide(id, { decision: "DELETE", reason: "x" });
      expect([400, 422]).toContain(res.status);
      expect(await stateOf(id)).toEqual(before);
    });

    it("sem corpo ⇒ 422 ou 400 e nada muda", async () => {
      const id = await prepare("PENDING_REVIEW");
      const before = await stateOf(id);
      const res = await decide(id, undefined);
      expect([400, 422]).toContain(res.status);
      expect(await stateOf(id)).toEqual(before);
    });

    it("campo extra no corpo (paymentInstructions) ⇒ 422 e nada muda (additionalProperties false)", async () => {
      const id = await prepare("PENDING_REVIEW");
      const before = await stateOf(id);
      await decide(id, { decision: "REJECT", reason: "Motivo.", paymentInstructions: "IBAN" }).expect(422);
      expect(await stateOf(id)).toEqual(before);
    });

    it("ciclo completo: APPROVE → SUSPEND → REACTIVATE → REQUEST_INFO → submissão do profissional → REJECT → REQUEST_INFO", async () => {
      const { id, token } = await runCycle();
      const cases = await caseRows(id);
      expect(cases.map((c) => `${c.from_status}>${c.to_status}:${c.action}`)).toEqual([
        "PENDING_REVIEW>APPROVED:APPROVED",
        "APPROVED>SUSPENDED:SUSPENDED",
        "SUSPENDED>APPROVED:REACTIVATED",
        "APPROVED>NEEDS_INFO:NEEDS_INFO",
        "NEEDS_INFO>PENDING_REVIEW:SUBMITTED",
        "PENDING_REVIEW>REJECTED:REJECTED",
        "REJECTED>NEEDS_INFO:NEEDS_INFO",
      ]);
      expect(cases.filter((c) => c.actor === "PROFESSIONAL")).toHaveLength(1);
      expect(cases.filter((c) => c.actor === "PLATFORM_ADMIN").every((c) => c.decided_by === ADMIN_USER_ID)).toBe(true);

      const me = await getMe(token).expect(200);
      expect(me.body).toMatchObject({ validationStatus: "NEEDS_INFO", statusReason: "Reenvie a cédula." });
    });

    it("o profissional vê statusReason e o estado novo em GET /me após cada decisão relevante", async () => {
      const pro = await readyProfessional();
      await setState(pro.professionalId, "PENDING_REVIEW");
      await decide(pro.professionalId, { decision: "REQUEST_INFO", reason: "Falta uma foto legível." }).expect(200);
      const me = await getMe(pro.token).expect(200);
      expect(me.body).toMatchObject({ validationStatus: "NEEDS_INFO", statusReason: "Falta uma foto legível.", approvedAt: null });
    });
  });

  // ---------------------------------------------------------------- (3) TC-MKT-13 concorrência

  describe("(3) TC-MKT-13 decisões concorrentes", () => {
    it("dois APPROVE em paralelo sobre o mesmo PENDING_REVIEW ⇒ exatamente um 200 e um 409; um só validation_case", async () => {
      const pro = await readyProfessional();
      await setState(pro.professionalId, "PENDING_REVIEW");
      const [first, second] = await Promise.all([decide(pro.professionalId, { decision: "APPROVE" }), decide(pro.professionalId, { decision: "APPROVE" })]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const losing = first.status === 409 ? first : second;
      expect(losing.body).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
      const cases = await caseRows(pro.professionalId);
      expect(cases.filter((c) => c.action === "APPROVED")).toHaveLength(1);
      expect(cases).toHaveLength(1);
    });

    it("REJECT contra APPROVE em paralelo ⇒ um só vence; estado e validation_case coerentes com o vencedor", async () => {
      const pro = await readyProfessional();
      await setState(pro.professionalId, "PENDING_REVIEW");
      const [approve, reject] = await Promise.all([
        decide(pro.professionalId, { decision: "APPROVE" }),
        decide(pro.professionalId, { decision: "REJECT", reason: "Concorrência." }),
      ]);
      expect([approve.status, reject.status].sort()).toEqual([200, 409]);
      const winner = approve.status === 200 ? approve : reject;
      const { rows } = await h.pool.query<{ validation_status: string }>("SELECT validation_status FROM professionals WHERE id = $1", [pro.professionalId]);
      expect(rows[0]?.validation_status).toBe(winner.body.validationStatus);
      const cases = await caseRows(pro.professionalId);
      expect(cases).toHaveLength(1);
      expect(cases[0]?.to_status).toBe(winner.body.validationStatus);
    });

    it("cinco SUSPEND em paralelo sobre um APPROVED ⇒ um 200 e quatro 409; um só validation_case", async () => {
      const pro = await h.newProfessional();
      await setState(pro.professionalId, "APPROVED");
      const results = await Promise.all(Array.from({ length: 5 }, () => decide(pro.professionalId, { decision: "SUSPEND", reason: "Em paralelo." })));
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409]);
      const cases = await caseRows(pro.professionalId);
      expect(cases.filter((c) => c.action === "SUSPENDED")).toHaveLength(1);
      expect(cases).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------- (4) TC-MKT-14 imutabilidade e auditoria

  describe("(4) TC-MKT-14 validation_cases imutável e auditoria sem motivo", () => {
    it("UPDATE direto em validation_cases falha com SQLSTATE 23000 (integrity_constraint_violation)", async () => {
      const pro = await pending();
      await decide(pro.professionalId, { decision: "REJECT", reason: "Motivo original." }).expect(200);
      const error = await h.pool
        .query("UPDATE validation_cases SET reason = 'x' WHERE professional_id = $1", [pro.professionalId])
        .then(
          () => null,
          (e: unknown) => e as { code?: string; message?: string },
        );
      expect(error?.code).toBe("23000");
      const { rows } = await h.pool.query<{ reason: string }>("SELECT reason FROM validation_cases WHERE professional_id = $1", [pro.professionalId]);
      expect(rows[0]?.reason).toBe("Motivo original.");
    });

    it("UPDATE de outras colunas (action) também falha", async () => {
      const pro = await pending();
      await decide(pro.professionalId, { decision: "REJECT", reason: "Motivo." }).expect(200);
      await expect(h.pool.query("UPDATE validation_cases SET action = 'APPROVED' WHERE professional_id = $1", [pro.professionalId])).rejects.toMatchObject({ code: "23000" });
    });

    it("motivo canário 'motivo-canario-xyz' fica em validation_cases mas NÃO em audit_logs (JSON de todas as linhas)", async () => {
      const pro = await pending();
      await decide(pro.professionalId, { decision: "REJECT", reason: "motivo-canario-xyz" }).expect(200);
      const cases = await h.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM validation_cases WHERE reason = 'motivo-canario-xyz'");
      expect(cases.rows[0]?.n).toBe(1);
      const { rows } = await h.pool.query<{ row: string }>("SELECT row_to_json(audit_logs)::text AS row FROM audit_logs");
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((r) => r.row.includes("motivo-canario-xyz"))).toBe(false);
    });

    it("cada decisão gera auditoria ADMIN_PROFESSIONAL_* com PLATFORM_ADMIN, actor do admin, metadata só {fromStatus,toStatus} e sem family_id", async () => {
      const { id } = await runCycle();
      const { rows } = await h.pool.query<{
        action: string;
        actor_type: string;
        actor_user_id: string | null;
        family_id: string | null;
        resource_type: string;
        result: string;
        metadata: Record<string, unknown>;
      }>(
        "SELECT action, actor_type, actor_user_id, family_id, resource_type, result, metadata FROM audit_logs WHERE resource_id = $1 AND action LIKE 'ADMIN_PROFESSIONAL_%' ORDER BY id",
        [id],
      );
      expect(rows.map((r) => r.action)).toEqual([
        "ADMIN_PROFESSIONAL_APPROVE",
        "ADMIN_PROFESSIONAL_SUSPEND",
        "ADMIN_PROFESSIONAL_REACTIVATE",
        "ADMIN_PROFESSIONAL_REQUEST_INFO",
        "ADMIN_PROFESSIONAL_REJECT",
        "ADMIN_PROFESSIONAL_REQUEST_INFO",
      ]);
      for (const r of rows) {
        expect(r).toMatchObject({ actor_type: "PLATFORM_ADMIN", actor_user_id: ADMIN_USER_ID, family_id: null, resource_type: "Professional", result: "SUCCESS" });
        expect(Object.keys(r.metadata).sort()).toEqual(["fromStatus", "toStatus"]);
      }
      expect(rows.map((r) => r.metadata)).toEqual([
        { fromStatus: "PENDING_REVIEW", toStatus: "APPROVED" },
        { fromStatus: "APPROVED", toStatus: "SUSPENDED" },
        { fromStatus: "SUSPENDED", toStatus: "APPROVED" },
        { fromStatus: "APPROVED", toStatus: "NEEDS_INFO" },
        { fromStatus: "PENDING_REVIEW", toStatus: "REJECTED" },
        { fromStatus: "REJECTED", toStatus: "NEEDS_INFO" },
      ]);
      // Cada uma das cinco ações aparece pelo menos uma vez.
      for (const decision of DECISIONS) expect(rows.map((r) => r.action)).toContain(AUDIT_ACTION[decision]);
    });

  });

  // ---------------------------------------------------------------- (5) download de credenciais pelo admin

  describe("(5) download de credenciais pelo admin (UC-MKT-06, BR-MKT-17/28)", () => {
    /** Upload como profissional (PDF por omissão). Sem antivírus: quem chama decide se corre `runScans`. */
    function upload(token: string, opts: { kind?: CredentialKind; buffer?: Buffer; filename?: string; fields?: Record<string, string> } = {}) {
      let req = request(h.app).post(CREDENTIALS).set("Authorization", `Bearer ${token}`).field("kind", opts.kind ?? "IDENTITY");
      for (const [name, value] of Object.entries(opts.fields ?? {})) req = req.field(name, value);
      return req.attach("file", opts.buffer ?? pdf(), { filename: opts.filename ?? "x.pdf", contentType: "application/pdf" });
    }
    const pdf = (): Buffer => Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n");

    async function auditDownloads(credentialId: string) {
      const { rows } = await h.pool.query<{ actor_type: string; actor_user_id: string | null; resource_type: string; family_id: string | null; row: string }>(
        "SELECT actor_type, actor_user_id, resource_type, family_id, row_to_json(audit_logs)::text AS row FROM audit_logs WHERE action = 'ADMIN_PROFESSIONAL_CREDENTIAL_DOWNLOAD' AND resource_id = $1 ORDER BY id",
        [credentialId],
      );
      return rows;
    }

    it("credencial CLEAN ⇒ 200 com bytes iguais, cabeçalhos de download e uma auditoria por download", async () => {
      const pro = await h.newProfessional();
      const up = await upload(pro.token, { kind: "IDENTITY" }).expect(201);
      const cid = up.body.id as string;
      await h.runScans();

      const buffer = pdf();
      const first = await downloadCredential(pro.professionalId, cid).expect(200);
      expect(Buffer.isBuffer(first.body) && first.body.equals(buffer)).toBe(true);
      expect(first.headers["content-type"]).toContain("application/octet-stream");
      expect(first.headers["cache-control"]).toContain("no-store");
      expect(first.headers["content-disposition"]).toMatch(/^attachment/);
      expect(first.headers["x-content-type-options"]).toBe("nosniff");

      await downloadCredential(pro.professionalId, cid).expect(200);
      const audits = await auditDownloads(cid);
      expect(audits).toHaveLength(2);
      for (const a of audits) {
        expect(a).toMatchObject({ actor_type: "PLATFORM_ADMIN", actor_user_id: ADMIN_USER_ID, resource_type: "ProfessionalCredential", family_id: null });
      }
    });

    it("auditoria do download não contém nome do ficheiro, número nem entidade emissora", async () => {
      const pro = await h.newProfessional();
      const up = await upload(pro.token, {
        kind: "PROFESSIONAL_LICENSE",
        filename: "nome-canario-cedula.pdf",
        fields: { number: "NUM-SEGREDO-123", issuingBody: "Orgao-Secreto" },
      }).expect(201);
      await h.runScans();
      await downloadCredential(pro.professionalId, up.body.id as string).expect(200);
      const audits = await auditDownloads(up.body.id as string);
      expect(audits).toHaveLength(1);
      const serialized = audits[0]?.row ?? "";
      expect(serialized).not.toContain("nome-canario-cedula");
      expect(serialized).not.toContain("NUM-SEGREDO-123");
      expect(serialized).not.toContain("Orgao-Secreto");
    });

    it("credencial PENDING ⇒ 409 DOCUMENT_NOT_AVAILABLE e sem auditoria", async () => {
      const pro = await h.newProfessional();
      const up = await upload(pro.token).expect(201);
      const res = await downloadCredential(pro.professionalId, up.body.id as string).expect(409);
      expect(res.body).toMatchObject({ code: "DOCUMENT_NOT_AVAILABLE" });
      expect(await auditDownloads(up.body.id as string)).toHaveLength(0);
    });

    it("credencial INFECTED ⇒ 409 DOCUMENT_NOT_AVAILABLE e sem auditoria", async () => {
      const pro = await h.newProfessional();
      const infected = Buffer.from(`%PDF-1.4\n${INFECTED_MARKER}\n%%EOF\n`);
      const up = await upload(pro.token, { kind: "PROFESSIONAL_LICENSE", buffer: infected }).expect(201);
      await h.runScans();
      const res = await downloadCredential(pro.professionalId, up.body.id as string).expect(409);
      expect(res.body).toMatchObject({ code: "DOCUMENT_NOT_AVAILABLE" });
      expect(await auditDownloads(up.body.id as string)).toHaveLength(0);
    });

    it("credencial de OUTRO profissional no caminho (professionalId trocado) ⇒ 404 sem auditoria", async () => {
      const owner = await h.newProfessional();
      const other = await h.newProfessional();
      const up = await upload(owner.token).expect(201);
      await h.runScans();
      const res = await downloadCredential(other.professionalId, up.body.id as string).expect(404);
      expect(res.body).toMatchObject({ code: "NOT_FOUND" });
      expect(await auditDownloads(up.body.id as string)).toHaveLength(0);
    });

    it("ids inexistentes ⇒ 404 (credencial inexistente, profissional inexistente, ambos)", async () => {
      const owner = await h.newProfessional();
      const up = await upload(owner.token).expect(201);
      await h.runScans();
      await downloadCredential(owner.professionalId, randomUUID()).expect(404);
      await downloadCredential(randomUUID(), up.body.id as string).expect(404);
      await downloadCredential(randomUUID(), randomUUID()).expect(404);
      expect(await auditDownloads(up.body.id as string)).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------- (6) TC-AZ-MKT-04 autorização e inventário

  describe("(6) TC-AZ-MKT-04 autorização e inventário de rotas", () => {
    it("inventário do openapi: /admin/professionals* tem exatamente GET lista, GET detalhe, POST decisions e GET ficheiro", () => {
      const paths = [...openApiPaths()].filter(([p]) => p.startsWith("/admin/professionals"));
      expect(Object.fromEntries(paths)).toEqual({
        "/admin/professionals": ["get"],
        "/admin/professionals/{professionalId}": ["get"],
        "/admin/professionals/{professionalId}/decisions": ["post"],
        "/admin/professionals/{professionalId}/credentials/{credentialId}/file": ["get"],
      });
    });

    it("o corpo de ProfessionalDecisionRequest só tem decision e reason (nenhum paymentInstructions)", () => {
      const text = readFileSync(openApiSpecPath(REPO_ROOT), "utf8");
      const start = text.indexOf("\n    ProfessionalDecisionRequest:");
      expect(start).toBeGreaterThan(0);
      const rest = text.slice(start + 1);
      const block = rest.slice(0, rest.search(/\n {4}\S/));
      expect(block).toContain("decision");
      expect(block).not.toMatch(/paymentInstructions|payment/i);
    });

    it("métodos PUT/PATCH/DELETE em /admin/professionals/{id} não existem (não 2xx, sem alterar nada)", async () => {
      const pro = await prepare("PENDING_REVIEW");
      const before = await stateOf(pro);
      for (const res of [
        await request(h.app).put(`${ADMIN}/${pro}`).set("Authorization", `Bearer ${admin}`).send({ reason: "x" }),
        await request(h.app).patch(`${ADMIN}/${pro}`).set("Authorization", `Bearer ${admin}`).send({ reason: "x" }),
        await request(h.app).delete(`${ADMIN}/${pro}`).set("Authorization", `Bearer ${admin}`),
      ]) {
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect([400, 404, 405]).toContain(res.status);
      }
      expect(await stateOf(pro)).toEqual(before);
    });

    it("User não-admin ⇒ 403 em lista, detalhe, decisão e ficheiro; nenhuma mudança na BD", async () => {
      const pro = await prepare("PENDING_REVIEW");
      const credPro = await h.newProfessional();
      const up = await request(h.app).post(CREDENTIALS).set("Authorization", `Bearer ${credPro.token}`).field("kind", "IDENTITY").attach("file", Buffer.from("%PDF-1.4\n%%EOF\n"), { filename: "x.pdf", contentType: "application/pdf" }).expect(201);
      await h.runScans();
      const user = await h.userToken();
      const dbBefore = await dbSnapshot();
      const stateBefore = await stateOf(pro);

      await list({}).set("Authorization", `Bearer ${user}`).expect(403);
      await detail(pro, user).expect(403);
      await decide(pro, { decision: "APPROVE" }, user).expect(403);
      await downloadCredential(credPro.professionalId, up.body.id as string, user).expect(403);

      expect(await stateOf(pro)).toEqual(stateBefore);
      expect(await dbSnapshot()).toEqual(dbBefore);
    });

    it("token de profissional e token de clínica ⇒ 401 em todas as rotas /admin/professionals*", async () => {
      const pro = await h.newProfessional();
      const clinic = await h.clinicToken();
      for (const token of [pro.token, clinic]) {
        await list({}).set("Authorization", `Bearer ${token}`).expect(401);
        await detail(pro.professionalId, token).expect(401);
        await decide(pro.professionalId, { decision: "APPROVE" }, token).expect(401);
        await downloadCredential(pro.professionalId, randomUUID(), token).expect(401);
      }
    });

    it("sem token ⇒ 401 em todas as rotas /admin/professionals*; nenhuma mudança na BD", async () => {
      const pro = await prepare("PENDING_REVIEW");
      const dbBefore = await dbSnapshot();
      await request(h.app).get(ADMIN).expect(401);
      await request(h.app).get(`${ADMIN}/${pro}`).expect(401);
      await request(h.app).post(`${ADMIN}/${pro}/decisions`).send({ decision: "APPROVE" }).expect(401);
      await request(h.app).get(`${ADMIN}/${pro}/credentials/${randomUUID()}/file`).expect(401);
      expect(await dbSnapshot()).toEqual(dbBefore);
    });
  });

  /** Totais que uma escrita indevida alteraria: validation_cases, auditorias de admin e linhas de profissionais. */
  async function dbSnapshot() {
    const cases = await h.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM validation_cases");
    const adminAudits = await h.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_logs WHERE action LIKE 'ADMIN_PROFESSIONAL_%'");
    const pros = await h.pool.query<{ n: number; sum: string }>("SELECT count(*)::int AS n, md5(string_agg(row_to_json(p)::text, '|' ORDER BY id)) AS sum FROM professionals p");
    return { cases: cases.rows[0]?.n, adminAudits: adminAudits.rows[0]?.n, pros: pros.rows[0] };
  }

  // ---------------------------------------------------------------- (7) TC-AZ-MKT-07 sem dados de saúde

  describe("(7) TC-AZ-MKT-07 nenhuma chave de saúde, família ou segredo nas respostas admin", () => {
    it("lista, detalhe e decisão não contêm nenhuma chave proibida (recursivamente)", async () => {
      const { id } = await runCycle();
      const listed = await list({ limit: 100, status: "NEEDS_INFO" }).expect(200);
      const detailed = await detail(id).expect(200);
      const other = await pending();
      const decided = await decide(other.professionalId, { decision: "REJECT", reason: "Verificação." }).expect(200);
      for (const body of [listed.body, detailed.body, decided.body]) {
        const keys = keysOf(body);
        const found = FORBIDDEN_KEYS.filter((k) => keys.has(k));
        expect(found).toEqual([]);
      }
    });
  });
  // ---------------------------------------------------------------- (8) RGPD: apagar o admin (último: invalida a sessão de teste)

  describe("(8) TC-MKT-14 apagar o admin mantém o histórico", () => {
    it("DELETE do user admin deixa decided_by NULL sem erro e o resto da linha igual (ON DELETE SET NULL)", async () => {
      const pro = await readyProfessional();
      await setState(pro.professionalId, "PENDING_REVIEW");
      await decide(pro.professionalId, { decision: "APPROVE" }).expect(200);
      const before = (await h.pool.query("SELECT * FROM validation_cases WHERE professional_id = $1", [pro.professionalId])).rows;
      expect(before[0]?.decided_by).toBe(ADMIN_USER_ID);

      await h.pool.query("DELETE FROM users WHERE id = $1", [ADMIN_USER_ID]);

      const after = (await h.pool.query("SELECT * FROM validation_cases WHERE professional_id = $1", [pro.professionalId])).rows;
      expect(after).toHaveLength(before.length);
      expect(after[0]?.decided_by).toBeNull();
      expect({ ...after[0], decided_by: undefined }).toEqual({ ...before[0], decided_by: undefined });
    });
  });
});
