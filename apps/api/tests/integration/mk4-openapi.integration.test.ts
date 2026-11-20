/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- corpos JSON de respostas HTTP lidos de forma dinâmica nos testes */
// Conformidade das 11 operações MK4 com o `openapi.yaml` (S10; TC-MKT-140; AC-MKT-45..55; FR-MKT-37..45): PostgreSQL real + API real, com validação
// de pedidos E respostas contra o contrato (o harness já o faz: uma resposta fora do contrato rebenta com 500). Com a flag da receita LIGADA.
//   (a) o inventário do yaml coincide com `MK4_OPERATION_IDS` (11) e `MK4_PENDING_OPERATION_IDS` está vazio; `PUBLIC_DATA_ROUTES` não inclui rotas MK4;
//       cada operação tem rota montada (sem token ⇒ 401) e um percurso feliz com pedido 2xx validado; todo o estado devolvido está declarado no contrato
//       (2xx, 4xx e 429) e a API não devolve 5xx; onde o contrato declara 429 e há limite, provoca-se e valida-se (`Retry-After`);
//   (b) `additionalProperties: false` nos corpos de pedido de MK4 (no yaml e na API real);
//   (c) `SharedRecordsView`: secções omitidas (nunca `null`), só as categorias concedidas, `ageYears` sempre; `no-store` e sem ETag na abertura;
//   (d) nenhuma propriedade `nullable: true` combinada com `allOf` nos schemas de MK4 (os de MK2/MK3/clínica têm 10 ocorrências anteriores: ver relatório).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PUBLIC_DATA_ROUTES } from "../../src/modules/discovery/interface/public-data-routes.js";
import { openApiSpecPath } from "../support/openapi-spec.js";
import { isMk4Path, makeCaller, parseOpsWithCodes, type CallOptions, type Mk4Op } from "../support/mk4-ops.js";
import { MK4_OPERATION_IDS, MK4_PENDING_OPERATION_IDS } from "../support/mk4-pending.js";
import { START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness, type OfferFixture, type ProfessionalFixture, type UserFixture } from "../support/consultations-harness.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const HOUR = 3_600_000;
const DAY = 86_400_000;
const yaml = readFileSync(openApiSpecPath(REPO_ROOT), "utf8");
const ALL_OPS = parseOpsWithCodes(yaml);
const OPS = ALL_OPS.filter((op) => MK4_OPERATION_IDS.has(op.id));
const OP_BY_ID = new Map<string, Mk4Op>(OPS.map((op) => [op.id, op] as const));
const keyOf = (op: Mk4Op): string => `${op.method.toUpperCase()} ${op.path}`;

let c: ConsultationsHarness;
/** Estados observados por operação (todos os pedidos do ficheiro). */
const observed = new Map<string, Set<number>>();
const call = (opId: string, o: CallOptions = {}): ReturnType<ReturnType<typeof makeCaller>> => caller(opId, o);
let caller: ReturnType<typeof makeCaller>;

const bodyOf = (res: { body: unknown }): Record<string, any> => res.body as Record<string, any>;
const at = (ms: number): Date => new Date(START.getTime() + ms);
let hourSeq = 0;
/** Início único por chamada (um profissional nunca tem duas marcações sobrepostas). */
const nextStart = (): Date => at((10 + hourSeq++) * HOUR);

async function must(opId: string, status: number, o: CallOptions = {}): Promise<Awaited<ReturnType<typeof call>>> {
  const res = await call(opId, o);
  if (res.status !== status) throw new Error(`${opId}: esperado ${String(status)}, obtido ${String(res.status)}: ${JSON.stringify(res.body)}`);
  return res;
}

interface Scene {
  pro: ProfessionalFixture;
  proToken: string;
  offer: OfferFixture;
  u: UserFixture;
  fam: string;
  m: string;
}

async function scene(): Promise<Scene> {
  c.h.clock.set(START);
  const pro = await c.professional({ name: "Dra. Conformidade MK4" });
  const offer = await c.offer(pro, { method: "VIDEO", durationMinutes: 30, priceKz: 0 });
  const u = await c.user("mk4-conf");
  const fam = await c.family("Família conformidade MK4");
  const m = await c.member(fam, { userId: u.id, role: "FAMILY_ADMIN", name: "Titular MK4" });
  return { pro, proToken: await c.professionalToken(pro.professionalId), offer, u, fam, m };
}

const confirmed = async (s: Scene): Promise<string> => (await c.seedBooking({ familyId: s.fam, memberId: s.m, offer: s.offer, startsAt: nextStart(), status: "CONFIRMED", createdByUserId: s.u.id })).bookingId;
/** Marcação `COMPLETED` há 1 h (dentro da janela de 7 dias da receita). */
async function completed(s: Scene): Promise<string> {
  const id = await confirmed(s);
  await c.h.pool.query("UPDATE bookings SET status = 'COMPLETED', completed_at = $2 WHERE id = $1", [id, at(-HOUR)]);
  return id;
}
const medication = (name = "Paracetamol MK4") => ({ name, dosage: "500 mg", scheduleType: "FIXED_TIMES", times: ["08:00"], startAt: at(DAY).toISOString(), endAt: at(8 * DAY).toISOString(), continuous: false });
const fam = (s: Scene) => ({ familyId: s.fam, memberId: s.m });
const body = (bookingId: string, extra: Record<string, unknown> = {}) => ({ bookingId, categories: ["MEDICATION"], validity: "D7", ...extra });

describe("MK4: conformidade OpenAPI das 11 operações de record-sharing e da receita digital (TC-MKT-140)", () => {
  beforeAll(async () => {
    c = await startConsultationsHarness({ digitalPrescription: true });
    caller = makeCaller(c.h.app, OP_BY_ID, (id, status) => {
      const set = observed.get(id) ?? new Set<number>();
      set.add(status);
      observed.set(id, set);
    });
  }, 300_000);

  afterAll(async () => {
    await c.stop();
  });

  describe("(a) inventário, rota montada, protegida e exercitada com resposta validada", () => {
    it("o inventário do yaml tem 11 operações MK4 e coincide com MK4_OPERATION_IDS; MK4_PENDING_OPERATION_IDS está vazio", () => {
      expect(MK4_PENDING_OPERATION_IDS.size).toBe(0);
      const byPath = ALL_OPS.filter((op) => isMk4Path(op.path)).map((op) => op.id).sort();
      expect(byPath).toHaveLength(11);
      expect(byPath).toEqual([...MK4_OPERATION_IDS].sort());
      expect(OPS).toHaveLength(11);
      expect(new Set(OPS.map(keyOf)).size).toBe(11);
    });

    it("PUBLIC_DATA_ROUTES (rotas sem decisão de política) não inclui nenhuma rota MK4", () => {
      for (const id of PUBLIC_DATA_ROUTES) {
        expect(MK4_OPERATION_IDS.has(id), id).toBe(false);
        const op = ALL_OPS.find((o) => o.id === id);
        expect(op && isMk4Path(op.path), id).toBe(false);
      }
    });

    it("cada operação declara 401 e a de família declara também 403/404; as do portal declaram 401 e 429 (contrato)", () => {
      for (const op of OPS) {
        expect(op.codes, op.id).toContain("401");
        expect(op.codes.some((code) => code.startsWith("2")), op.id).toBe(true);
        if (op.path.startsWith("/families/")) expect(op.codes, op.id).toEqual(expect.arrayContaining(["403", "404"]));
        if (op.path.startsWith("/professional-portal/")) expect(op.codes, op.id).toContain("429");
      }
    });

    it.each(OPS.map((op) => [keyOf(op), op] as const))("%s sem token ⇒ 401 (a rota existe, com a flag ligada: nunca 404/405/500)", async (_label, op) => {
      const res = await call(op.id, { body: op.method === "get" ? undefined : {} });
      expect(res.status).toBe(401);
      expect(bodyOf(res).code).toBe("UNAUTHENTICATED");
    });

    it("percurso feliz: cada uma das 11 operações tem pelo menos um pedido 2xx cuja resposta passa a validação do contrato, com `no-store`", async () => {
      const s = await scene();
      const f = fam(s);
      const bk = await confirmed(s);
      const done = await completed(s);

      const options = await must("getRecordShareOptions", 200, { params: f, query: { bookingId: bk }, token: s.u.token });
      expect(bodyOf(options).allowedCategories).toEqual(["ALLERGIES", "CONDITIONS", "MEDICATION", "APPOINTMENTS", "EXAMS"]);
      const clientRequestId = "11111111-1111-4111-8111-111111111111";
      const created = await must("createRecordShare", 201, { params: f, token: s.u.token, body: body(bk, { clientRequestId }) });
      const shareId = bodyOf(created).id as string;
      expect((await must("createRecordShare", 200, { params: f, token: s.u.token, body: body(bk, { clientRequestId }) })).body).toEqual(created.body);
      expect((await must("listRecordShares", 200, { params: f, token: s.u.token })).body.items).toHaveLength(1);
      await must("getRecordShare", 200, { params: { ...f, shareId }, token: s.u.token });

      expect((await must("listProfessionalShares", 200, { token: s.proToken })).body.items).toHaveLength(1);
      await must("getProfessionalShare", 200, { params: { shareId }, token: s.proToken });
      const open = await must("openProfessionalShare", 200, { params: { shareId }, token: s.proToken });
      expect(open.headers["cache-control"]).toMatch(/no-store/);
      expect(open.headers.etag).toBeUndefined();
      const views = await must("listRecordShareViews", 200, { params: { ...f, shareId }, token: s.u.token });
      expect(bodyOf(views).items).toHaveLength(1);
      await must("revokeRecordShare", 200, { params: { ...f, shareId }, token: s.u.token });

      const issued = await must("issueProfessionalPrescription", 201, { params: { bookingId: done }, token: s.proToken, body: { notes: "Tomar com água.", medications: [medication()] } });
      expect(bodyOf(issued).bookingId).toBe(done);
      const got = await must("getProfessionalBookingPrescription", 200, { params: { bookingId: done }, token: s.proToken });
      expect(got.body).toEqual(issued.body);

      for (const res of [options, created, views, open, issued, got]) expect(res.headers["cache-control"], res.get("Content-Type")).toMatch(/no-store/);
      expect([...MK4_OPERATION_IDS].filter((id) => !(observed.get(id) ?? new Set<number>()).has(200) && !(observed.get(id) ?? new Set<number>()).has(201)).sort()).toEqual([]);
    }, 120_000);

    it("erros declarados: 400, 403, 404, 409, 422 e 423 devolvem problem+json validado e nunca 5xx", async () => {
      const s = await scene();
      const f = fam(s);
      const bk = await confirmed(s);
      const req = await c.seedBooking({ familyId: s.fam, memberId: s.m, offer: s.offer, startsAt: nextStart(), createdByUserId: s.u.id });
      const shareId = bodyOf(await must("createRecordShare", 201, { params: f, token: s.u.token, body: body(bk) })).id as string;

      const checks: [string, number, string, CallOptions][] = [
        ["listRecordShares", 400, "MALFORMED_REQUEST", { params: f, token: s.u.token, query: { limit: "0" } }],
        ["listRecordShareViews", 400, "MALFORMED_REQUEST", { params: { ...f, shareId }, token: s.u.token, query: { cursor: "nao-e-cursor" } }],
        ["listProfessionalShares", 400, "MALFORMED_REQUEST", { token: s.proToken, query: { cursor: "nao-e-cursor" } }],
        ["getRecordShare", 404, "NOT_FOUND", { params: f, token: s.u.token }],
        ["getProfessionalShare", 404, "NOT_FOUND", { token: s.proToken }],
        ["openProfessionalShare", 404, "NOT_FOUND", { token: s.proToken }],
        ["getProfessionalBookingPrescription", 404, "NOT_FOUND", { token: s.proToken }],
        ["issueProfessionalPrescription", 404, "NOT_FOUND", { token: s.proToken, body: { medications: [medication()] } }],
        ["getRecordShareOptions", 409, "INVALID_STATE_TRANSITION", { params: f, token: s.u.token, query: { bookingId: req.bookingId } }],
        ["createRecordShare", 409, "INVALID_STATE_TRANSITION", { params: f, token: s.u.token, body: body(req.bookingId) }],
        ["createRecordShare", 422, "VALIDATION_ERROR", { params: f, token: s.u.token, body: body(bk, { categories: [] }) }],
        ["issueProfessionalPrescription", 409, "INVALID_STATE_TRANSITION", { params: { bookingId: bk }, token: s.proToken, body: { medications: [medication()] } }],
        ["issueProfessionalPrescription", 422, "VALIDATION_ERROR", { params: { bookingId: await completed(s) }, token: s.proToken, body: { medications: [{ ...medication(), name: "  " }] } }],
      ];
      for (const [op, status, code, o] of checks) {
        const res = await call(op, o);
        expect([res.status, bodyOf(res).code], `${op}: ${JSON.stringify(res.body)}`).toEqual([status, code]);
        expect(res.headers["content-type"], op).toMatch(/application\/problem\+json/);
      }
      // 403 (DEPENDENT_SELF e OTHER) e a recusa de abrir (SHARE_NOT_AVAILABLE) e de reabrir uma visualização única (SHARE_ALREADY_VIEWED).
      const other = await c.user("mk4-outro");
      await c.member(s.fam, { userId: other.id, role: "FAMILY_MEMBER", name: "Sem relação" });
      for (const op of ["getRecordShareOptions", "listRecordShares", "listRecordShareViews", "getRecordShare", "revokeRecordShare"]) {
        const res = await call(op, { params: { ...f, shareId }, token: other.token, query: op === "getRecordShareOptions" ? { bookingId: bk } : {} });
        expect([res.status, bodyOf(res).code], op).toEqual([403, "FORBIDDEN"]);
      }
      expect((await call("createRecordShare", { params: f, token: other.token, body: body(bk) })).status).toBe(403);
      await must("revokeRecordShare", 200, { params: { ...f, shareId }, token: s.u.token });
      const revokedAgain = await call("revokeRecordShare", { params: { ...f, shareId }, token: s.u.token });
      expect([revokedAgain.status, bodyOf(revokedAgain).code]).toEqual([409, "INVALID_STATE_TRANSITION"]);
      const closed = await call("openProfessionalShare", { params: { shareId }, token: s.proToken });
      expect([closed.status, bodyOf(closed).code]).toEqual([403, "SHARE_NOT_AVAILABLE"]);
      const once = bodyOf(await must("createRecordShare", 201, { params: f, token: s.u.token, body: body(bk, { viewOnce: true }) })).id as string;
      await must("openProfessionalShare", 200, { params: { shareId: once }, token: s.proToken });
      const twice = await call("openProfessionalShare", { params: { shareId: once }, token: s.proToken });
      expect([twice.status, bodyOf(twice).code]).toEqual([403, "SHARE_ALREADY_VIEWED"]);
      // 423: dependente bloqueado (o tutor continua a pedir; um membro com conta não pode ser bloqueado).
      const blocked = await c.member(s.fam, { dependent: true, blocked: true, guardians: [s.m], name: "Bloqueado" });
      for (const op of ["getRecordShareOptions", "listRecordShares", "getRecordShare", "listRecordShareViews", "revokeRecordShare"]) {
        const res = await call(op, { params: { familyId: s.fam, memberId: blocked, shareId: once }, token: s.u.token, query: op === "getRecordShareOptions" ? { bookingId: bk } : {} });
        expect([res.status, bodyOf(res).code], op).toEqual([423, "MEMBER_BLOCKED"]);
      }
      expect((await call("createRecordShare", { params: { familyId: s.fam, memberId: blocked }, token: s.u.token, body: body(bk) })).status).toBe(423);
      // 403 do portal: especialidade WELLNESS não emite receita.
      const wellness = await c.professional({ name: "Coach MK4" });
      await c.h.pool.query("UPDATE specialties SET category = 'WELLNESS' WHERE id = $1", [wellness.specialtyId]);
      const wo = await c.offer(wellness, { method: "VIDEO", durationMinutes: 30, priceKz: 0 });
      const wf = await scene();
      const wb = (await c.seedBooking({ familyId: wf.fam, memberId: wf.m, offer: wo, startsAt: nextStart(), status: "CONFIRMED", createdByUserId: wf.u.id })).bookingId;
      await c.h.pool.query("UPDATE bookings SET status = 'COMPLETED', completed_at = $2 WHERE id = $1", [wb, at(-HOUR)]);
      const forbidden = await call("issueProfessionalPrescription", { params: { bookingId: wb }, token: await c.professionalToken(wellness.professionalId), body: { medications: [medication()] } });
      expect([forbidden.status, bodyOf(forbidden).code]).toEqual([403, "FORBIDDEN"]);
      // 409 CONFLICT (segunda receita) e PROFESSIONAL_LOCKED.
      const done = await completed(wf);
      await must("issueProfessionalPrescription", 201, { params: { bookingId: done }, token: wf.proToken, body: { medications: [medication()] } });
      const second = await call("issueProfessionalPrescription", { params: { bookingId: done }, token: wf.proToken, body: { medications: [medication()] } });
      expect([second.status, bodyOf(second).code]).toEqual([409, "CONFLICT"]);
      await c.h.pool.query("UPDATE professionals SET validation_status = 'SUSPENDED' WHERE id = $1", [wf.pro.professionalId]);
      const done2 = await completed(wf);
      const locked = await call("issueProfessionalPrescription", { params: { bookingId: done2 }, token: wf.proToken, body: { medications: [medication()] } });
      expect([locked.status, bodyOf(locked).code]).toEqual([409, "PROFESSIONAL_LOCKED"]);
    }, 120_000);

    it("429: o contrato declara-o onde há limite; a API devolve-o com Retry-After, validado, em todas as operações que o declaram", async () => {
      // Leituras da família: 60/min por utilizador (opções, lista, detalhe e vistas partilham o balde).
      const a = await scene();
      const fa = fam(a);
      const bk = await confirmed(a);
      const shareId = bodyOf(await must("createRecordShare", 201, { params: fa, token: a.u.token, body: body(bk) })).id as string;
      let limited = await exhaust("listRecordShares", { params: fa, token: a.u.token });
      expect(limited.headers["retry-after"]).toMatch(/^\d+$/);
      expect(bodyOf(limited).code).toBe("RATE_LIMITED");
      for (const [op, o] of [
        ["getRecordShareOptions", { params: fa, query: { bookingId: bk }, token: a.u.token }],
        ["getRecordShare", { params: { ...fa, shareId }, token: a.u.token }],
        ["listRecordShareViews", { params: { ...fa, shareId }, token: a.u.token }],
      ] as [string, CallOptions][]) {
        limited = await call(op, o);
        expect([limited.status, limited.headers["retry-after"] !== undefined], op).toEqual([429, true]);
      }

      // Criação: 20/dia por utilizador (esgotada com 20 partilhas criadas e revogadas; antes disso o limite de 20 ativas dá 409).
      const b = await scene();
      const fb = fam(b);
      const bkB = await confirmed(b);
      const ids: string[] = [];
      for (let i = 0; i < 20; i++) ids.push(bodyOf(await must("createRecordShare", 201, { params: fb, token: b.u.token, body: body(bkB, { validity: "H24" }) })).id as string);
      const full = await call("createRecordShare", { params: fb, token: b.u.token, body: body(bkB) });
      expect([full.status, bodyOf(full).code]).toEqual([409, "LIMIT_EXCEEDED"]);
      for (const id of ids) await must("revokeRecordShare", 200, { params: { ...fb, shareId: id }, token: b.u.token });
      const daily = await call("createRecordShare", { params: fb, token: b.u.token, body: body(bkB) });
      expect([daily.status, bodyOf(daily).code, daily.headers["retry-after"] !== undefined]).toEqual([429, "RATE_LIMITED", true]);

      // Leituras do profissional: 60/min por conta (lista e detalhe partilham o balde).
      const r = await scene();
      const rShare = bodyOf(await must("createRecordShare", 201, { params: fam(r), token: r.u.token, body: body(await confirmed(r)) })).id as string;
      limited = await exhaust("listProfessionalShares", { token: r.proToken });
      expect(limited.headers["retry-after"]).toMatch(/^\d+$/);
      expect((await call("getProfessionalShare", { params: { shareId: rShare }, token: r.proToken })).status).toBe(429);

      // Abertura: 30/min por conta.
      const o = await scene();
      const oShare = bodyOf(await must("createRecordShare", 201, { params: fam(o), token: o.u.token, body: body(await confirmed(o)) })).id as string;
      limited = await exhaust("openProfessionalShare", { params: { shareId: oShare }, token: o.proToken });
      expect(limited.headers["retry-after"]).toMatch(/^\d+$/);

      // Receita: leitura 60/min; emissão 20/dia por conta.
      const p = await scene();
      const noRx = await completed(p);
      limited = await exhaust("getProfessionalBookingPrescription", { params: { bookingId: noRx }, token: p.proToken });
      expect(limited.headers["retry-after"]).toMatch(/^\d+$/);
      const i = await scene();
      for (let n = 0; n < 20; n++) await must("issueProfessionalPrescription", 201, { params: { bookingId: await completed(i) }, token: i.proToken, body: { medications: [medication(`Fármaco ${String(n)}`)] } });
      const over = await call("issueProfessionalPrescription", { params: { bookingId: await completed(i) }, token: i.proToken, body: { medications: [medication()] } });
      expect([over.status, bodyOf(over).code, over.headers["retry-after"] !== undefined]).toEqual([429, "RATE_LIMITED", true]);

      for (const op of OPS.filter((x) => x.codes.includes("429") && x.id !== "createRecordShare")) expect((observed.get(op.id) ?? new Set<number>()).has(429), `${op.id} nunca devolveu 429`).toBe(true);
      expect(observed.get("createRecordShare")?.has(429)).toBe(true);
    }, 300_000);

    it("todo o estado devolvido por cada operação está declarado no contrato (2xx, 4xx e 429) e nenhuma devolveu 5xx", () => {
      for (const op of OPS) {
        const seen = [...(observed.get(op.id) ?? new Set<number>())];
        expect(seen.length, op.id).toBeGreaterThan(0);
        for (const status of seen) {
          expect(status, `${op.id} devolveu 5xx`).toBeLessThan(500);
          expect(op.codes, `${op.id} devolveu ${String(status)} sem o declarar`).toContain(String(status));
        }
      }
    });
  });

  describe("(b) additionalProperties: false nos corpos de pedido de MK4", () => {
    it.each(["CreateRecordShareRequest", "ProfessionalPrescriptionInput"])("no yaml: %s declara additionalProperties: false", (name) => {
      expect(schemaBlock(name), name).toMatch(/\n {6}additionalProperties: false\b/);
    });

    it("na API real: um campo desconhecido (também ids de família, de utilizador e de profissional) ⇒ 400/422; sem ele a validação passa", async () => {
      const s = await scene();
      const f = fam(s);
      const bk = await confirmed(s);
      const done = await completed(s);
      for (const k of ["extra", "userId", "familyId", "memberId", "professionalId", "participantLabel", "issuedBy"]) {
        const share = await call("createRecordShare", { params: f, token: s.u.token, body: body(bk, { [k]: "x" }) });
        expect([400, 422], `createRecordShare + ${k} ⇒ ${String(share.status)}`).toContain(share.status);
        const rx = await call("issueProfessionalPrescription", { params: { bookingId: done }, token: s.proToken, body: { medications: [medication()], [k]: "x" } });
        expect([400, 422], `issueProfessionalPrescription + ${k} ⇒ ${String(rx.status)}`).toContain(rx.status);
      }
      expect((await c.h.pool.query("SELECT count(*)::int AS n FROM record_shares WHERE family_id = $1", [s.fam])).rows[0]?.n).toBe(0);
      expect((await c.h.pool.query("SELECT count(*)::int AS n FROM prescriptions WHERE booking_id = $1", [done])).rows[0]?.n).toBe(0);
      await must("createRecordShare", 201, { params: f, token: s.u.token, body: body(bk) });
    });
  });

  describe("(c) SharedRecordsView: secções omitidas, nunca null (BR-MKT-68; TC-MKT-124)", () => {
    const BASE = ["ageYears", "expiresAt", "openedAt", "participantLabel", "shareId", "viewOnce", "watermark"];
    const SECTIONS: Record<string, string[]> = {
      ALLERGIES: ["allergies", "bloodType"],
      CONDITIONS: ["conditions"],
      MEDICATION: ["medications"],
      APPOINTMENTS: ["appointments"],
      EXAMS: ["examinations"],
    };

    it("no yaml: as secções de SharedRecordsView não são `nullable` e só `ageYears`/identificação são obrigatórios", () => {
      const block = schemaBlock("SharedRecordsView");
      for (const key of ["allergies", "bloodType", "conditions", "medications", "appointments", "examinations"]) {
        const line = block.split("\n").find((l) => new RegExp(`^ {8}${key}:`).test(l));
        expect(line, key).toBeDefined();
        expect(line, key).not.toMatch(/nullable/);
      }
      expect(block).toMatch(/required: \[shareId, participantLabel, ageYears, openedAt, expiresAt, viewOnce, watermark\]/);
    });

    it.each([...Object.keys(SECTIONS), "TODAS"])("abertura com %s: só as secções concedidas (as outras omitidas), `ageYears` sempre e nenhum `null` no topo", async (category) => {
      const s = await scene();
      const bk = await confirmed(s);
      const categories = category === "TODAS" ? Object.keys(SECTIONS) : [category];
      const shareId = bodyOf(await must("createRecordShare", 201, { params: fam(s), token: s.u.token, body: body(bk, { categories }) })).id as string;
      const view = bodyOf(await must("openProfessionalShare", 200, { params: { shareId }, token: s.proToken }));
      expect(Object.keys(view).sort()).toEqual([...BASE, ...categories.flatMap((x) => SECTIONS[x] ?? [])].sort());
      for (const [key, value] of Object.entries(view)) expect(value, key).not.toBeNull();
      expect(view.ageYears).toBe(41);
      expect(view.watermark).toEqual({ professionalName: "Dra. Conformidade MK4", openedOn: "2026-11-16" });
    });
  });

  describe("(d) contrato: nenhuma propriedade nullable com allOf nos schemas de MK4", () => {
    const ROOTS = ["RecordShareOptions", "CreateRecordShareRequest", "RecordShare", "RecordSharePage", "RecordShareView", "RecordShareViewPage", "ProfessionalShare", "ProfessionalSharePage", "SharedRecordsView", "ProfessionalPrescriptionInput", "ProfessionalPrescription"];
    /** Schemas alcançáveis por `$ref` a partir de `roots` (sem os comuns a todo o contrato). */
    const closure = (): string[] => {
      const seen = new Set<string>();
      const visit = (name: string): void => {
        if (seen.has(name) || ["Problem", "FieldError"].includes(name)) return;
        seen.add(name);
        for (const m of schemaBlock(name).matchAll(/#\/components\/schemas\/(\w+)/g)) visit(m[1] ?? "");
      };
      ROOTS.forEach(visit);
      return [...seen].sort();
    };

    it("nenhuma propriedade dos schemas de MK4 (e dos que referenciam) tem `nullable: true` junto de `allOf` (em linha ou em bloco)", () => {
      const names = closure();
      expect(names).toEqual(expect.arrayContaining(ROOTS));
      const indentOf = (l: string): number => l.length - l.trimStart().length;
      const offenders: string[] = [];
      for (const name of names) {
        const lines = schemaBlock(name).split("\n");
        lines.forEach((line, index) => {
          if (line.includes("allOf") && /nullable:\s*true/.test(line)) offenders.push(`${name}: ${line.trim().slice(0, 80)}`);
          if (!/^\s*allOf:\s*$/.test(line)) return;
          const level = indentOf(line);
          const siblings: string[] = [];
          for (let i = index - 1; i >= 0 && (lines[i] ?? "").trim() !== "" && indentOf(lines[i] ?? "") >= level; i--) if (indentOf(lines[i] ?? "") === level) siblings.push(lines[i] ?? "");
          for (let i = index + 1; i < lines.length && (lines[i] ?? "").trim() !== "" && indentOf(lines[i] ?? "") >= level; i++) if (indentOf(lines[i] ?? "") === level) siblings.push(lines[i] ?? "");
          if (siblings.some((l) => /^\s*nullable:\s*true/.test(l))) offenders.push(`${name}: allOf em bloco com nullable: true`);
        });
      }
      expect(offenders).toEqual([]);
    });
  });
});

/** Repete a operação até devolver 429 (máximo 70 pedidos; os limites são de 30 a 60 por minuto com o relógio parado). */
async function exhaust(opId: string, o: CallOptions): Promise<Awaited<ReturnType<typeof call>>> {
  for (let n = 0; n < 70; n++) {
    const res = await call(opId, o);
    if (res.status === 429) return res;
  }
  throw new Error(`${opId}: o limite nunca foi atingido`);
}

// --- Leitura do yaml (indentação do contrato: schemas a 4 espaços; propriedades a 8) ---

/** Texto do schema `name` em `components.schemas` (do cabeçalho de 4 espaços até ao seguinte). */
function schemaBlock(name: string): string {
  const lines = yaml.slice(yaml.indexOf("\ncomponents:")).split("\n");
  const start = lines.findIndex((l) => l === `    ${name}:`);
  if (start < 0) throw new Error(`schema inexistente: ${name}`);
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,4}\S/.test(line)) break;
    out.push(line);
  }
  return `\n${out.join("\n")}`;
}
