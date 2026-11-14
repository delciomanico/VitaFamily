// Varrimento contrato ↔ código das rotas de `insurer-ops` (TC-AZ-SEG, qa-security): (1) o router regista exatamente as operações
// do openapi (nenhuma rota sem contrato nem contrato sem rota); (2) todo caso de uso decide papel/módulo/acesso antes de tocar nos
// dados (`authorize*`/`assertClinicRole`), isto é, nenhuma rota fica sem decisão de autorização (ADR-025, authorization.md §8).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Router } from "express";
import { describe, expect, it } from "vitest";
import { createInsurerClinicRouter } from "../src/modules/insurer-ops/interface/clinic-router.js";
import { createInsurerPatientRouter } from "../src/modules/insurer-ops/interface/patient-router.js";
import { createInsurerOpsRouter } from "../src/modules/insurer-ops/interface/portal-router.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** `método caminho` de cada operação do contrato cujo caminho começa por um dos prefixos (lido do `openapi.d.ts` gerado do YAML). */
function contractOperations(prefixes: RegExp): Set<string> {
  const source = readFileSync(join(ROOT, "src/generated/openapi.d.ts"), "utf8");
  const found = new Set<string>();
  for (const block of source.split(/\n {4}"(?=\/)/).slice(1)) {
    const path = /^([^"]+)": \{/.exec(block)?.[1];
    if (path === undefined || !prefixes.test(path)) continue;
    const head = block.split(/\n {4}"\//)[0] ?? block;
    for (const method of METHODS) if (new RegExp(`\\n {8}${method}: operations\\[`).test(head)) found.add(`${method} ${path}`);
  }
  return found;
}

function routerOperations(router: Router): Set<string> {
  const found = new Set<string>();
  for (const layer of (router as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack) {
    if (!layer.route) continue;
    for (const method of METHODS) if (layer.route.methods[method]) found.add(`${method} ${layer.route.path.replace(/:(\w+)/g, "{$1}")}`);
  }
  return found;
}

const stub = (): never => new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
const sorted = (set: Set<string>): string[] => [...set].sort();

describe("insurer-ops: rotas ↔ openapi", () => {
  it("portal da seguradora: as rotas do router são exatamente as operações do contrato desses recursos", () => {
    const own = /^\/insurance-portal\/(me|companies|beneficiaries|imports|link-requests|policies|plans|services|partner-clinics|providers|catalog-types|service-kinds|policy-settings)(\/|$)/;
    const contract = contractOperations(own);
    expect(contract.size).toBeGreaterThan(30);
    expect(sorted(routerOperations(createInsurerOpsRouter(stub())))).toEqual(sorted(contract));
  });

  it("portal da clínica: /clinic-portal/insurers*", () => {
    const contract = contractOperations(/^\/clinic-portal\/insurers(\/|$)/);
    expect(contract.size).toBe(3);
    expect(sorted(routerOperations(createInsurerClinicRouter(stub())))).toEqual(sorted(contract));
  });

  it("app do paciente: /families/{familyId}/members/{memberId}/insurance/*", () => {
    const contract = contractOperations(/^\/families\/\{familyId\}\/members\/\{memberId\}\/insurance(\/|$)/);
    expect(contract.size).toBe(6);
    expect(sorted(routerOperations(createInsurerPatientRouter(stub())))).toEqual(sorted(contract));
  });
});

describe("insurer-ops: todo caso de uso decide a autorização", () => {
  const dir = join(ROOT, "src/modules/insurer-ops/application");
  // `portal-me`: aberto a qualquer papel e com o módulo desativado por desenho (P-SEG-3); o ator vem do token e só lê a própria seguradora.
  // `ExpirePoliciesJob`, `PurgeImportPreviewsJob`: jobs de sistema, sem ator HTTP.
  const exempt = new Set(["createGetPortalMeUseCase", "createExpirePoliciesJobUseCase", "createPurgeImportPreviewsJobUseCase"]);
  const decision = /\b(authorize|authorizePatient|authorizeClinic|assertClinicRole)\(/;

  it("cada `create*UseCase` chama authorize/authorizePatient/authorizeClinic/assertClinicRole", () => {
    const offenders: string[] = [];
    let total = 0;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      const parts = readFileSync(join(dir, file), "utf8").split(/\nexport function (?=create\w+UseCase)/).slice(1);
      for (const part of parts) {
        const name = /^(\w+)/.exec(part)?.[1] ?? "?";
        total++;
        if (!exempt.has(name) && !decision.test(part)) offenders.push(`${file}:${name}`);
      }
    }
    expect(total).toBeGreaterThan(40);
    expect(offenders).toEqual([]);
  });
});
