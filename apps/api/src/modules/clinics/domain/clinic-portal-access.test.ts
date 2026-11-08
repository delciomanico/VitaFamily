// TC-AZ-CLN-V5 (authorization.md §6.2b): a matriz papel × rota é dados; este teste compara-a com o contrato (openapi.yaml)
// e com as rotas REALMENTE registadas nos routers do portal, para nenhuma rota ficar de fora (fail closed).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Router } from "express";
import { describe, expect, it } from "vitest";
import { createClinicAuditRouter } from "../../audit/interface/clinic-audit-router.js";
import { createAppointmentsClinicPortalRouter } from "../../appointments/interface/clinic-portal-router.js";
import { createClinicPatientsPortalRouter } from "../../clinic-patients/interface/portal-router.js";
import { createClinicReceiptsPortalRouter } from "../../clinic-receipts/interface/portal-router.js";
import { createClinicReportsPortalRouter } from "../../clinic-reports/interface/portal-router.js";
import { createExaminationsClinicPortalRouter } from "../../examinations/interface/clinic-portal-router.js";
import { createRecommendationsClinicPortalRouter } from "../../recommendations/interface/clinic-portal-router.js";
import { createClinicPortalRouter } from "../interface/clinic-portal-router.js";
import { CLINIC_PORTAL_ACCESS, accessFor, assertPortalAccess, findPortalRule, type PortalAccess } from "./clinic-portal-access.js";

const SPEC = join(dirname(fileURLToPath(import.meta.url)), "../../../../../../docs/05-api/openapi.yaml");

/** Operações `/clinic-portal/*` do contrato: `METHOD /caminho-express`. */
function contractOperations(): Set<string> {
  const ops = new Set<string>();
  let path: string | undefined;
  for (const line of readFileSync(SPEC, "utf8").split("\n")) {
    const p = /^ {2}(\/clinic-portal\/[^:]*):\s*$/.exec(line);
    if (p?.[1]) path = p[1].replace(/\{(\w+)\}/g, ":$1");
    else if (/^ {2}\S/.test(line)) path = undefined;
    const m = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    if (m?.[1] && path) ops.add(`${m[1].toUpperCase()} ${path}`);
  }
  return ops;
}

function registeredOperations(routers: Router[]): Set<string> {
  const ops = new Set<string>();
  for (const router of routers) {
    for (const layer of (router as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack) {
      if (!layer.route) continue;
      for (const method of Object.keys(layer.route.methods)) ops.add(`${method.toUpperCase()} ${layer.route.path}`);
    }
  }
  return ops;
}

const stub = {} as never;
const ROUTERS = [
  createClinicPortalRouter(stub, "example.pt"),
  createAppointmentsClinicPortalRouter(stub),
  createExaminationsClinicPortalRouter(stub),
  createRecommendationsClinicPortalRouter(stub),
  createClinicPatientsPortalRouter(stub),
  createClinicReceiptsPortalRouter(stub),
  createClinicReportsPortalRouter(stub),
  createClinicAuditRouter(stub),
];

describe("matriz papel × rota do portal da clínica (TC-AZ-CLN-V5)", () => {
  const matrix = new Set(CLINIC_PORTAL_ACCESS.map((r) => `${r.method} ${r.path}`));

  it("tem exatamente as operações /clinic-portal/* do openapi.yaml", () => {
    expect([...contractOperations()].sort()).toEqual([...matrix].sort());
  });

  it("tem exatamente as rotas /clinic-portal/* registadas nos routers", () => {
    const registered = [...registeredOperations(ROUTERS)].filter((op) => op.includes(" /clinic-portal/"));
    expect(registered.sort()).toEqual([...matrix].sort());
  });

  const expected: [string, string, PortalAccess, PortalAccess, PortalAccess][] = [
    ["GET", "/clinic-portal/receipts", "yes", "yes", "no"],
    ["POST", "/clinic-portal/receipts/abc/void", "yes", "yes", "no"],
    ["GET", "/clinic-portal/profile", "yes", "yes", "no"],
    ["PATCH", "/clinic-portal/profile", "yes", "no", "no"],
    ["GET", "/clinic-portal/audit", "yes", "no", "no"],
    ["POST", "/clinic-portal/staff", "yes", "no", "no"],
    ["GET", "/clinic-portal/reports/summary", "yes", "yes", "no"],
    ["GET", "/clinic-portal/search", "yes", "yes", "no"],
    ["PUT", "/clinic-portal/agenda/abc/start", "yes", "yes", "own"],
    ["PUT", "/clinic-portal/agenda/abc/arrive", "yes", "yes", "no"],
    ["GET", "/clinic-portal/calendar", "yes", "yes", "own"],
    ["GET", "/clinic-portal/patients/abc/record", "yes", "yes", "own"],
    ["POST", "/clinic-portal/patients/link", "yes", "yes", "no"],
    ["PUT", "/clinic-portal/exam-agenda/abc/cancel", "yes", "yes", "no"],
    ["POST", "/clinic-portal/recommendations", "yes", "yes", "own"],
    // M15 (authorization.md §6.2b, TC-AZ-CLN-V6): relatório da consulta — só o Médico escreve; Admin/Gestor leem.
    ["GET", "/clinic-portal/agenda/abc/report", "yes", "yes", "own"],
    ["GET", "/clinic-portal/agenda/abc/report/pdf", "yes", "yes", "own"],
    ["PUT", "/clinic-portal/agenda/abc/report", "no", "no", "own"],
    ["PUT", "/clinic-portal/agenda/abc/report/finalize", "no", "no", "own"],
    ["POST", "/clinic-portal/agenda/abc/report/addenda", "no", "no", "own"],
    ["GET", "/clinic-portal/exam-agenda/abc/results-draft", "yes", "yes", "own"],
    ["PUT", "/clinic-portal/exam-agenda/abc/results-draft", "yes", "yes", "own"],
    ["DELETE", "/clinic-portal/exam-agenda/abc/results-draft", "yes", "yes", "own"],
    ["GET", "/clinic-portal/exam-agenda/abc/report/pdf", "yes", "yes", "own"],
  ];
  it.each(expected)("%s %s => Admin %s · Gestor %s · Médico %s", (method, path, admin, manager, doctor) => {
    const rule = findPortalRule(method, `/api/v1${path}`);
    expect(rule).toBeDefined();
    if (!rule) return;
    expect([accessFor(rule, "CLINIC_ADMIN"), accessFor(rule, "CLINIC_MANAGER"), accessFor(rule, "CLINIC_DOCTOR")]).toEqual([admin, manager, doctor]);
  });

  it("rota fora da matriz => FORBIDDEN (fecha por omissão); papel sem acesso => FORBIDDEN; 'suas' passa", () => {
    expect(() => assertPortalAccess("CLINIC_ADMIN", "GET", "/api/v1/clinic-portal/desconhecida")).toThrow(expect.objectContaining({ code: "FORBIDDEN" }) as Error);
    expect(() => assertPortalAccess("CLINIC_DOCTOR", "GET", "/api/v1/clinic-portal/receipts")).toThrow(expect.objectContaining({ code: "FORBIDDEN" }) as Error);
    expect(assertPortalAccess("CLINIC_DOCTOR", "GET", "/api/v1/clinic-portal/agenda")).toBe("own");
    expect(assertPortalAccess("CLINIC_MANAGER", "GET", "/api/v1/clinic-portal/receipts")).toBe("yes");
  });
});
