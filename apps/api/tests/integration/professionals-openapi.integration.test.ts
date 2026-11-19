/* eslint-disable @typescript-eslint/no-unsafe-member-access -- respostas HTTP sem tipagem (supertest devolve `any`). */
// Integração (PostgreSQL real + API real validada contra o openapi.yaml) da conformidade das 34 operações de MK1 (TC-MKT-36; TC-AZ-MKT-01/04):
// rota montada e protegida, tokens cruzados, `additionalProperties: false` e o código `PROFESSIONAL_LOCKED` no catálogo de erros.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorCatalog } from "../../src/platform/errors/codes.js";
import { openApiSpecPath } from "../support/openapi-spec.js";
import { MK3_OPERATION_IDS } from "../support/mk3-pending.js";
import { API, nextIp, startProfessionalsHarness, type ProfessionalsHarness } from "../support/professionals-harness.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const EXAMPLE_ID = "00000000-0000-4000-8000-00000000abcd";

type Method = "get" | "post" | "put" | "patch" | "delete";
type Security = "public" | "professional" | "user";
interface OpSpec {
  method: Method;
  path: string;
  /** public = `security: []`; professional = `professionalBearerAuth`; user = sem chave, herda o `bearerAuth` global (User). */
  security: Security;
  line: number;
}

/**
 * Lê as operações de `paths` por linhas (não há parser YAML nas dependências de `apps/api`). Assume a indentação do contrato:
 * caminhos a 2 espaços, métodos a 4, `security` a 6.
 */
export function parseOperations(yaml: string): OpSpec[] {
  const lines = yaml.split("\n");
  const ops: OpSpec[] = [];
  let inPaths = false;
  let path: string | null = null;
  let current: OpSpec | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\S/.test(line)) {
      inPaths = line === "paths:";
      path = null;
      current = null;
      continue;
    }
    if (!inPaths) continue;
    const pathMatch = /^ {2}(\/\S*):\s*$/.exec(line);
    if (pathMatch) {
      path = pathMatch[1] ?? null;
      current = null;
      continue;
    }
    const methodMatch = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    if (methodMatch && path !== null) {
      current = { method: methodMatch[1] as Method, path, security: "user", line: i + 1 };
      ops.push(current);
      continue;
    }
    const idMatch = /^ {6}operationId: (\w+)/.exec(line);
    if (idMatch && current !== null && MK3_OPERATION_IDS.has(idMatch[1] ?? "")) {
      // Operações MK3 ainda por implementar ficam fora até à S13 (tests/support/mk3-pending.ts).
      ops.pop();
      current = null;
      continue;
    }
    if (current !== null && /^ {6}security:/.test(line)) {
      if (/^ {6}security:\s*\[\s*\]\s*$/.test(line)) {
        current.security = "public";
      } else {
        const next = lines[i + 1] ?? "";
        current.security = next.includes("professionalBearerAuth") ? "professional" : "user";
      }
    }
  }
  return ops;
}

const OPS = parseOperations(readFileSync(openApiSpecPath(REPO_ROOT), "utf8")).filter((op) => ["/professional-portal/", "/admin/professionals", "/admin/specialties"].some((p) => op.path.startsWith(p)))
  // As rotas de conversas (MK2, `messaging`) têm o seu próprio teste de conformidade; esta lista é o contrato de MK1.
  .filter((op) => !op.path.startsWith("/professional-portal/conversations"));
const keyOf = (op: OpSpec): string => `${op.method.toUpperCase()} ${op.path}`;

/** Corpos válidos (para o teste de autorização do User não-admin, que só chega à guarda com corpo válido). */
const VALID_BODY: Record<string, unknown> = {
  "POST /admin/specialties": { name: "Especialidade Teste", category: "WELLNESS" },
  "PATCH /admin/specialties/{specialtyId}": { name: "Especialidade Renomeada" },
  "POST /admin/professionals/{professionalId}/decisions": { decision: "REJECT", reason: "motivo de teste" },
  "PATCH /professional-portal/me": { displayName: "Nome Valido" },
  "POST /professional-portal/offers": { specialtyId: EXAMPLE_ID, method: "VIDEO", durationMinutes: 30, priceKz: 1000 },
};

/** Chamada HTTP à operação (path params = `EXAMPLE_ID`), com ou sem token e corpo opcional. */
function call(h: ProfessionalsHarness, op: OpSpec, body: unknown, token?: string) {
  const url = `${API}${op.path.replace(/\{[^}]+\}/g, EXAMPLE_ID)}`;
  const agent = request(h.app);
  const started = op.method === "get" ? agent.get(url) : op.method === "post" ? agent.post(url) : op.method === "put" ? agent.put(url) : op.method === "patch" ? agent.patch(url) : agent.delete(url);
  const withIp = started.set("X-Forwarded-For", nextIp());
  const withAuth = token === undefined ? withIp : withIp.set("Authorization", `Bearer ${token}`);
  return op.method === "get" || body === undefined ? withAuth : withAuth.send(body as Record<string, unknown>);
}

describe("TC-MKT-36: conformidade OpenAPI das operações de professionals (contrato de MK1)", () => {
  let h: ProfessionalsHarness;
  let tokens: { user: string; clinic: string; admin: string; professional: string };

  beforeAll(async () => {
    h = await startProfessionalsHarness();
    tokens = {
      user: await h.userToken(),
      clinic: await h.clinicToken(),
      admin: await h.adminToken(),
      professional: (await h.newProfessional()).token,
    };
  }, 120_000);

  afterAll(async () => {
    await h.stop();
  });

  it("(a) contagem: exatamente 34 operações (8 de auth; 27 em /professional-portal/*; 7 em /admin/*), 7 públicas", () => {
    // Número real contado em docs/05-api/openapi.yaml (parser por linhas): 34. Se o contrato mudar, este teste deve mudar com ele.
    expect(OPS).toHaveLength(34);
    expect(OPS.filter((o) => o.path.startsWith("/professional-portal/auth/"))).toHaveLength(8);
    expect(OPS.filter((o) => o.path.startsWith("/professional-portal/"))).toHaveLength(27);
    expect(OPS.filter((o) => o.path.startsWith("/admin/"))).toHaveLength(7);
    expect(OPS.filter((o) => o.security === "public")).toHaveLength(7);
    expect(OPS.filter((o) => o.security === "professional")).toHaveLength(20); // inclui /auth/logout
    expect(OPS.filter((o) => o.security === "user")).toHaveLength(7); // /admin/* herdam o bearerAuth global
  });

  describe("(b) rota montada e protegida: sem token nunca 404/405/500", () => {
    it.each(OPS.map((op) => [keyOf(op), op] as const))("%s", async (_label, op) => {
      const res = await call(h, op, {});
      expect([404, 405]).not.toContain(res.status);
      expect(res.status).not.toBe(500);
      if (op.security === "public") {
        // Auth pública: validação/neutra (4xx), nunca 2xx sem credenciais de conta (refresh sem cookie ⇒ 401).
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      } else {
        expect(res.status).toBe(401);
      }
    });
  });

  describe("(c) tokens cruzados (TC-AZ-MKT-01/04)", () => {
    it("controlo positivo: o token de profissional abre GET /professional-portal/me (200)", async () => {
      const op = OPS.find((o) => keyOf(o) === "GET /professional-portal/me");
      if (!op) throw new Error("GET /professional-portal/me não está no contrato");
      const res = await call(h, op, undefined, tokens.professional);
      expect(res.status).toBe(200);
    });

    it("controlo positivo: o token de Platform Admin abre GET /admin/professionals (200)", async () => {
      const op = OPS.find((o) => keyOf(o) === "GET /admin/professionals");
      if (!op) throw new Error("GET /admin/professionals não está no contrato");
      const res = await call(h, op, undefined, tokens.admin);
      expect(res.status).toBe(200);
    });

    it.each(OPS.filter((o) => o.security === "professional").map((op) => [keyOf(op), op] as const))("token de User em %s ⇒ 401", async (_label, op) => {
      const res = await call(h, op, VALID_BODY[keyOf(op)] ?? {}, tokens.user);
      expect(res.status).toBe(401);
    });

    it.each(OPS.filter((o) => o.security === "user").map((op) => [keyOf(op), op] as const))("token de ClinicAccount em %s ⇒ 401", async (_label, op) => {
      const res = await call(h, op, VALID_BODY[keyOf(op)] ?? {}, tokens.clinic);
      expect(res.status).toBe(401);
    });

    it.each(OPS.filter((o) => o.security === "user").map((op) => [keyOf(op), op] as const))("token de profissional em %s ⇒ 401", async (_label, op) => {
      const res = await call(h, op, VALID_BODY[keyOf(op)] ?? {}, tokens.professional);
      expect(res.status).toBe(401);
    });

    it.each(OPS.filter((o) => o.security === "user").map((op) => [keyOf(op), op] as const))("User não-admin em %s ⇒ 403", async (_label, op) => {
      const res = await call(h, op, VALID_BODY[keyOf(op)] ?? {}, tokens.user);
      expect(res.status).toBe(403);
    });
  });

  describe("(d) additionalProperties: false rejeita campo desconhecido num corpo de outro modo válido ⇒ 422 VALIDATION_ERROR", () => {
    const CASES: { op: string; who: "professional" | "admin"; body: Record<string, unknown> }[] = [
      { op: "POST /professional-portal/offers", who: "professional", body: { specialtyId: EXAMPLE_ID, method: "VIDEO", durationMinutes: 30, priceKz: 1000, campoDesconhecido: 1 } },
      { op: "PATCH /professional-portal/me", who: "professional", body: { displayName: "Nome Valido", campoDesconhecido: 1 } },
      { op: "POST /professional-portal/schedule-rules", who: "professional", body: { offerId: EXAMPLE_ID, weekdays: [1], startTime: "08:00", endTime: "09:00", campoDesconhecido: 1 } },
      { op: "POST /professional-portal/time-off", who: "professional", body: { startsAt: "2026-12-20T08:00:00.000Z", endsAt: "2026-12-20T09:00:00.000Z", campoDesconhecido: 1 } },
      { op: "POST /admin/specialties", who: "admin", body: { name: "Especialidade Teste", category: "WELLNESS", campoDesconhecido: 1 } },
      { op: "POST /admin/professionals/{professionalId}/decisions", who: "admin", body: { decision: "APPROVE", campoDesconhecido: 1 } },
    ];
    it.each(CASES.map((c) => [c.op, c] as const))("%s", async (_label, c) => {
      const [method, path] = c.op.split(" ") as [string, string];
      const op: OpSpec = { method: method.toLowerCase() as Method, path, security: c.who === "admin" ? "user" : "professional", line: 0 };
      expect(OPS.some((o) => keyOf(o) === c.op)).toBe(true); // o caso existe no contrato
      const token = c.who === "admin" ? tokens.admin : tokens.professional;
      const res = await call(h, op, c.body, token);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("(e) catálogo de erros", () => {
    it("PROFESSIONAL_LOCKED: HTTP 409 em src/platform/errors/codes.ts e listado em docs/05-api/errors.md", () => {
      expect(errorCatalog.PROFESSIONAL_LOCKED.status).toBe(409);
      const errorsMd = readFileSync(join(REPO_ROOT, "docs/05-api/errors.md"), "utf8");
      expect(errorsMd).toMatch(/\| `PROFESSIONAL_LOCKED` \| 409 \|/);
    });
  });
});
