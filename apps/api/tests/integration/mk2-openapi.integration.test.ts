// Conformidade das 25 operações novas de MK2 (TC-MKT-74; TC-AZ-MKT-09; TC-MKT-47/68; TC-AZ-MKT-15 por inventário): rota montada e
// protegida, tokens cruzados, corpos fechados, ausência de «boost» e de anexos, admin sem rota de leitura de conversas.
// PostgreSQL real + API real validada contra o `openapi.yaml`; as portas de `messaging` são stubs (só se exercita a fronteira HTTP).
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDiscoveryModule } from "../../src/modules/discovery/index.js";
import { createMessagingModule } from "../../src/modules/messaging/index.js";
import { errorCatalog } from "../../src/platform/errors/codes.js";
import { openApiSpecPath } from "../support/openapi-spec.js";
import { MK3_OPERATION_IDS } from "../support/mk3-pending.js";
import { API, nextIp, startProfessionalsHarness, type ProfessionalsHarness } from "../support/professionals-harness.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const ID = "00000000-0000-4000-8000-00000000abcd";

type Method = "get" | "post" | "put" | "patch" | "delete";
type Area = "marketplace" | "family" | "professional" | "admin";
interface Op {
  method: Method;
  path: string;
  area: Area;
}

const yaml = readFileSync(openApiSpecPath(REPO_ROOT), "utf8");

function areaOf(path: string): Area | null {
  if (path.startsWith("/marketplace/")) return "marketplace";
  if (path.startsWith("/families/{familyId}/members/{memberId}/conversations")) return "family";
  if (path.startsWith("/professional-portal/conversations")) return "professional";
  if (path.startsWith("/admin/message-reports")) return "admin";
  return null;
}

/** Operações de `paths` (indentação do contrato: caminhos a 2 espaços, métodos a 4). */
function parseOps(text: string): Op[] {
  const ops: Op[] = [];
  let inPaths = false;
  let path: string | null = null;
  let pending = false;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) {
      inPaths = line === "paths:";
      path = null;
      continue;
    }
    if (!inPaths) continue;
    const p = /^ {2}(\/\S*):\s*$/.exec(line);
    if (p) {
      path = p[1] ?? null;
      continue;
    }
    const m = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    const area = path === null ? null : areaOf(path);
    if (m && path !== null && area !== null) {
      ops.push({ method: m[1] as Method, path, area });
      pending = true;
      continue;
    }
    if (m) pending = false;
    const id = /^ {6}operationId: (\w+)/.exec(line);
    if (id && pending) {
      // Operações MK3 ainda por implementar ficam fora até à S13 (tests/support/mk3-pending.ts).
      if (MK3_OPERATION_IDS.has(id[1] ?? "")) ops.pop();
      pending = false;
    }
  }
  return ops;
}

const OPS = parseOps(yaml);
const keyOf = (op: Op): string => `${op.method.toUpperCase()} ${op.path}`;
const MK2_PROTECTED = OPS; // todas exigem autenticação (nenhuma é pública)

const VALID_BODY: Record<string, unknown> = {
  "POST /admin/message-reports/{reportId}/decisions": { decision: "DISMISS" },
  "POST /professional-portal/conversations/{conversationId}/messages": { text: "olá" },
  "POST /professional-portal/conversations/{conversationId}/messages/{messageId}/reports": { reason: "SPAM" },
};

describe("MK2: conformidade OpenAPI das operações de discovery e messaging", () => {
  let h: ProfessionalsHarness;
  let tokens: { user: string; clinic: string; admin: string; professional: string };

  function call(op: Op, token?: string, body?: unknown) {
    const url = `${API}${op.path.replace(/\{[^}]+\}/g, ID)}`;
    const agent = request(h.app);
    const started = op.method === "get" ? agent.get(url) : op.method === "post" ? agent.post(url) : agent.put(url);
    const withIp = started.set("X-Forwarded-For", nextIp());
    const withAuth = token === undefined ? withIp : withIp.set("Authorization", `Bearer ${token}`);
    return op.method === "get" ? withAuth : withAuth.send((body ?? {}) as Record<string, unknown>);
  }

  beforeAll(async () => {
    h = await startProfessionalsHarness({}, ({ audit, db, clock, module }) => {
      const discovery = createDiscoveryModule({ clock, catalog: { listApprovedFacts: (q) => module.directory.listApprovedFacts(q), getApprovedFacts: (ids) => module.directory.getApprovedFacts(ids) } });
      const messaging = createMessagingModule({
        db,
        audit,
        clock,
        access: { assertCanMessage: () => Promise.reject(new Error("não usado")) },
        professionals: { findIdentities: (ids) => module.directory.getConversationIdentities(ids), getNotificationEmail: () => Promise.resolve(null) },
        alerts: { raiseMessageReceived: () => Promise.resolve(), markConversationRead: () => Promise.resolve() },
        noticeQueue: { enqueue: () => Promise.resolve() },
      });
      return [discovery.router, messaging.router, messaging.professionalRouter, messaging.adminRouter];
    });
    tokens = { user: await h.userToken(), clinic: await h.clinicToken(), admin: await h.adminToken(), professional: (await h.newProfessional()).token };
  }, 240_000);

  afterAll(async () => {
    await h.stop();
  });

  it("(a) contagem: 25 operações (5 marketplace, 9 família, 8 profissional, 3 admin)", () => {
    expect(OPS).toHaveLength(25);
    for (const [area, n] of [["marketplace", 5], ["family", 9], ["professional", 8], ["admin", 3]] as const) expect(OPS.filter((o) => o.area === area), area).toHaveLength(n);
    expect(new Set(OPS.map(keyOf)).size).toBe(25);
  });

  describe("(b) rota montada e protegida: sem token ⇒ 401 (nunca 404/405/500)", () => {
    it.each(MK2_PROTECTED.map((op) => [keyOf(op), op] as const))("%s", async (_l, op) => {
      const res = await call(op, undefined, VALID_BODY[keyOf(op)]);
      expect(res.status).toBe(401);
    });
  });

  describe("(c) tokens cruzados (TC-AZ-MKT-09)", () => {
    it("controlos positivos: User em /marketplace, profissional no portal e admin na fila ⇒ 200", async () => {
      expect((await call({ method: "get", path: "/marketplace/ranking-rules", area: "marketplace" }, tokens.user)).status).toBe(200);
      expect((await call({ method: "get", path: "/professional-portal/conversations", area: "professional" }, tokens.professional)).status).toBe(200);
      expect((await call({ method: "get", path: "/admin/message-reports", area: "admin" }, tokens.admin)).status).toBe(200);
    });
    it.each(OPS.filter((o) => o.area === "marketplace" || o.area === "family").map((op) => [keyOf(op), op] as const))("profissional e clínica em %s ⇒ 401", async (_l, op) => {
      expect((await call(op, tokens.professional, VALID_BODY[keyOf(op)])).status).toBe(401);
      expect((await call(op, tokens.clinic, VALID_BODY[keyOf(op)])).status).toBe(401);
    });
    it.each(OPS.filter((o) => o.area === "professional").map((op) => [keyOf(op), op] as const))("User (também admin) e clínica em %s ⇒ 401", async (_l, op) => {
      for (const token of [tokens.user, tokens.admin, tokens.clinic]) expect((await call(op, token, VALID_BODY[keyOf(op)])).status).toBe(401);
    });
    it.each(OPS.filter((o) => o.area === "admin").map((op) => [keyOf(op), op] as const))("profissional e clínica ⇒ 401 e User não admin ⇒ 403 em %s", async (_l, op) => {
      expect((await call(op, tokens.professional, VALID_BODY[keyOf(op)])).status).toBe(401);
      expect((await call(op, tokens.clinic, VALID_BODY[keyOf(op)])).status).toBe(401);
      expect((await call(op, tokens.user, VALID_BODY[keyOf(op)])).status).toBe(403);
    });
  });

  describe("(d) corpos fechados e sem anexos (TC-MKT-74/68)", () => {
    const FAMILY_POST = { method: "post", path: "/families/{familyId}/members/{memberId}/conversations", area: "family" } as const;
    const FAMILY_SEND = { method: "post", path: "/families/{familyId}/members/{memberId}/conversations/{conversationId}/messages", area: "family" } as const;
    const PRO_SEND = { method: "post", path: "/professional-portal/conversations/{conversationId}/messages", area: "professional" } as const;
    const DECIDE = { method: "post", path: "/admin/message-reports/{reportId}/decisions", area: "admin" } as const;

    it("campos desconhecidos (incl. `attachments`) ⇒ 4xx de validação, nunca 2xx nem 5xx", async () => {
      const cases: [Op, string, Record<string, unknown>][] = [
        [FAMILY_POST, tokens.user, { professionalId: ID, participantLabel: "Ana", text: "olá", attachments: [] }],
        [FAMILY_SEND, tokens.user, { text: "olá", fileId: ID }],
        [PRO_SEND, tokens.professional, { text: "olá", attachments: [{ name: "x" }] }],
        [DECIDE, tokens.admin, { decision: "DISMISS", extra: 1 }],
      ];
      for (const [op, token, body] of cases) {
        const res = await call(op, token, body);
        expect([400, 422], `${keyOf(op)} ⇒ ${String(res.status)}`).toContain(res.status);
      }
    });

    it("multipart em rotas de conversas ⇒ 400/415 (BR-MKT-39)", async () => {
      const res = await request(h.app).post(`${API}/professional-portal/conversations/${ID}/messages`).set("Authorization", `Bearer ${tokens.professional}`).set("X-Forwarded-For", nextIp()).field("text", "olá").attach("file", Buffer.from("x"), "a.txt");
      expect([400, 415]).toContain(res.status);
      const fam = await request(h.app).post(`${API}/families/${ID}/members/${ID}/conversations/${ID}/messages`).set("Authorization", `Bearer ${tokens.user}`).set("X-Forwarded-For", nextIp()).field("text", "olá").attach("file", Buffer.from("x"), "a.txt");
      expect([400, 415]).toContain(fam.status);
    });

    it("o contrato não declara multipart, binário nem campos de ficheiro nas rotas de conversas e nos schemas de mensagens", () => {
      const convSections = yaml.split("\n").filter((l) => /^ {2}\/\S*conversations/.test(l)).length;
      expect(convSections).toBeGreaterThan(10);
      let inConv = false;
      const offending: string[] = [];
      for (const line of yaml.split("\n")) {
        const path = /^ {2}(\/\S*):\s*$/.exec(line);
        if (path) inConv = (path[1] ?? "").includes("conversations");
        if (inConv && /multipart|format: binary|\b(attachments?|fileId|fileUrl|ficheiro\w*):/i.test(line)) offending.push(line.trim());
      }
      expect(offending).toEqual([]);
      const schemas = yaml.slice(yaml.indexOf("\ncomponents:"));
      const messageSchemas = schemas.split("\n").filter((l) => /^ {4}(Chat|Message|Conversation)\w*:\s*$/.test(l));
      expect(messageSchemas.length).toBeGreaterThan(3);
    });
  });

  describe("(e) sem «boost»/pagamento no ranking (TC-MKT-47) e admin sem conteúdo (TC-AZ-MKT-15)", () => {
    const FORBIDDEN = /\b(boost\w*|featured|sponsored|promoted|is_?paid|premium)\b/i;

    it("openapi.yaml, schema.md e migrações não têm campo/coluna/parâmetro/valor de ordenação de destaque ou pagamento", () => {
      const migrations = join(REPO_ROOT, "apps/api/db/migrations");
      const files = [join(REPO_ROOT, "docs/05-api/openapi.yaml"), join(REPO_ROOT, "docs/07-database/schema.md"), ...readdirSync(migrations).map((f) => join(migrations, f))];
      const hits = files.flatMap((f) => readFileSync(f, "utf8").split("\n").filter((l) => FORBIDDEN.test(l)).map((l) => `${f}: ${l.trim()}`));
      expect(hits).toEqual([]);
    });

    it("`sort` das pesquisas só aceita RANKING, PRICE_ASC, PRICE_DESC e NEXT_AVAILABLE; o admin não tem rota para a ordem", () => {
      const block = /name: sort\b[\s\S]{0,400}/.exec(yaml.slice(yaml.indexOf("  /marketplace/professionals:")))?.[0] ?? "";
      for (const v of ["RANKING", "PRICE_ASC", "PRICE_DESC", "NEXT_AVAILABLE"]) expect(block).toContain(v);
      const adminPaths = yaml.split("\n").map((l) => /^ {2}(\/admin\/\S*):/.exec(l)?.[1]).filter((p): p is string => p !== undefined);
      expect(adminPaths.filter((p) => /rank|marketplace|discovery|order/i.test(p))).toEqual([]);
    });

    it("as únicas rotas de admin que tocam conversas ou mensagens são as 3 de /admin/message-reports", () => {
      const adminPaths = yaml.split("\n").map((l) => /^ {2}(\/admin\/\S*):/.exec(l)?.[1]).filter((p): p is string => p !== undefined);
      expect(adminPaths.filter((p) => /conversation|message/i.test(p)).sort()).toEqual(["/admin/message-reports:", "/admin/message-reports/{reportId}:", "/admin/message-reports/{reportId}/decisions:"].map((p) => p.slice(0, -1)));
      expect(OPS.filter((o) => o.area === "admin" && o.method === "get").map((o) => o.path).sort()).toEqual(["/admin/message-reports", "/admin/message-reports/{reportId}"]);
    });
  });

  it("(f) catálogo de erros: CONVERSATION_CLOSED é 409 em codes.ts e em errors.md", () => {
    expect(errorCatalog.CONVERSATION_CLOSED.status).toBe(409);
    expect(readFileSync(join(REPO_ROOT, "docs/05-api/errors.md"), "utf8")).toMatch(/\| `CONVERSATION_CLOSED` \| 409 \|/);
  });
});
