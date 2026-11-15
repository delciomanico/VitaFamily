// Teste de arquitetura (equivalente ao `arch_test.go` do ADR-013): o grafo de imports de `src/`
// tem de respeitar as fronteiras de camadas (ADR-015) e as dependências entre módulos
// (docs/06-architecture/modules.md §2-3). Em M0 só existe `platform`; a verificação por módulo
// fica pronta e provada (com dados sintéticos) para M1 em diante usar imediatamente.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkArchitecture, MODULE_DEPENDENCIES, type FileImports } from "./architecture-rules.js";
import { collectImports } from "./collect-imports.js";

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

describe("arquitetura do código real (src/)", () => {
  it("não tem violações das regras de camadas/módulos", async () => {
    const files = await collectImports(SRC_ROOT);
    expect(files.length).toBeGreaterThan(0); // o scanner tem de encontrar ficheiros reais
    const violations = checkArchitecture(files);
    expect(violations).toEqual([]);
  });

  it("TC-PRC-20 / AC-PRC-07: só main e `alerts` (fatia 5, nota 33, pela raiz) importam `processes`, e `processes` só importa `access` e `audit`", async () => {
    const files = await collectImports(SRC_ROOT);
    const processesFiles = files.filter((f) => f.file.startsWith("modules/processes/"));
    expect(processesFiles.length).toBeGreaterThan(0);

    const importers = files.filter((f) => !f.file.startsWith("modules/processes/") && f.relativeImports.some((target) => target.startsWith("modules/processes/")));
    expect(importers.map((f) => f.file)).toEqual(["main/api", "main/worker", "modules/alerts/index"]);

    const importedModules = new Set(processesFiles.flatMap((f) => f.relativeImports).filter((t) => t.startsWith("modules/") && !t.startsWith("modules/processes/")).map((t) => t.split("/")[1]));
    expect([...importedModules].sort()).toEqual([...(MODULE_DEPENDENCIES.processes ?? [])].sort());
    for (const [name, dependencies] of Object.entries(MODULE_DEPENDENCIES)) {
      // Fatia 5 (ADR-036, modules.md nota 33): `alerts` lê o dono/«aberto» do processo pela raiz; mais nenhum módulo.
      expect(dependencies.includes("processes"), `${name} não pode depender de processes`).toBe(name === "alerts");
    }
  });

  it("TC-PRC-20: processes/domain só importa o próprio domain (sem platform/Clock/I/O) e as portas ficam onde o contrato manda", async () => {
    const files = await collectImports(SRC_ROOT);
    for (const file of files.filter((f) => f.file.startsWith("modules/processes/domain/"))) {
      expect(file.bareImports, file.file).toEqual([]);
      for (const target of file.relativeImports) expect(target.startsWith("modules/processes/domain/"), `${file.file} -> ${target}`).toBe(true);
    }
    // `ProcessFacts` em processes/application; `ProcessLinker` definida em cada dono (nunca importada de processes).
    const [processPorts, appointmentPorts, examinationPorts] = await Promise.all(
      ["processes", "appointments", "examinations"].map((m) => readFile(join(SRC_ROOT, "modules", m, "application", "ports.ts"), "utf8")),
    );
    expect(processPorts).toMatch(/export interface ProcessFacts</);
    expect(appointmentPorts).toMatch(/export interface ProcessLinkerPort</);
    expect(examinationPorts).toMatch(/export interface ProcessLinkerPort</);
    expect(processPorts).not.toMatch(/export interface ProcessLinkerPort</);
  });

  it("TC-AUT-19 (modules.md nota 31): insurer-ops e processes não se importam; portas onde o contrato manda; ficheiros puros só importam domain/", async () => {
    const files = await collectImports(SRC_ROOT);
    const cross = files.filter(
      (f) =>
        (f.file.startsWith("modules/insurer-ops/") && f.relativeImports.some((t) => t.startsWith("modules/processes/"))) ||
        (f.file.startsWith("modules/processes/") && f.relativeImports.some((t) => t.startsWith("modules/insurer-ops/"))),
    );
    expect(cross.map((f) => f.file)).toEqual([]);
    expect(MODULE_DEPENDENCIES["insurer-ops"]).toEqual(["audit"]);
    expect(MODULE_DEPENDENCIES.processes).toEqual(["access", "audit"]);
    const read = (m: string, f: string) => readFile(join(SRC_ROOT, "modules", m, "application", f), "utf8");
    expect(await read("insurer-ops", "ports.ts")).toMatch(/export interface ProcessLinker</);
    expect(await read("insurer-ops", "ports.ts")).toMatch(/export interface AttachmentFiles</);
    expect(await read("processes", "ports.ts")).toMatch(/getCoverageFacts\(/);
    expect(await read("processes", "ports.ts")).not.toMatch(/export interface ProcessLinker</);
    expect(await read("appointments", "ports.ts")).toMatch(/export interface CompletionReceiptIssuer</);
    // Fatia 4 (TC-DEC-20): `auto-approval`, `authorization-actions`, `sla` e `authorization-decision` também só importam `domain/`.
    for (const name of ["authorization-machine", "deadline", "coverage-phase", "auto-approval", "authorization-actions", "sla", "authorization-decision", "authorization-code"]) {
      const file = files.find((f) => f.file === `modules/insurer-ops/domain/${name}`);
      expect(file, name).toBeDefined();
      expect(file?.bareImports, name).toEqual([]);
      for (const target of file?.relativeImports ?? []) expect(target.startsWith("modules/insurer-ops/domain/"), `${name} -> ${target}`).toBe(true);
    }
  });

  it("TC-PRC-32 (ADR-036, modules.md nota 33): `insurer-ops` não importa `alerts` (só a porta FamilyNotifier); `alerts` importa `insurer-ops`/`processes` só pela raiz; sem ciclos; coverage-phase/deriveCoverageView puros; o «3 dias» só em alerts/domain/rule.ts", async () => {
    const files = await collectImports(SRC_ROOT);
    expect(files.filter((f) => f.file.startsWith("modules/insurer-ops/") && f.relativeImports.some((t) => t.startsWith("modules/alerts/"))).map((f) => f.file)).toEqual([]);
    expect(files.filter((f) => f.file.startsWith("modules/processes/") && f.relativeImports.some((t) => t.startsWith("modules/alerts/"))).map((f) => f.file)).toEqual([]);
    expect(MODULE_DEPENDENCIES["insurer-ops"]).toEqual(["audit"]);
    expect(MODULE_DEPENDENCIES.processes).toEqual(["access", "audit"]);
    expect(MODULE_DEPENDENCIES.alerts).toEqual(expect.arrayContaining(["insurer-ops", "processes"]));
    const alertImports = files.filter((f) => f.file.startsWith("modules/alerts/")).flatMap((f) => f.relativeImports.map((target) => [f.file, target] as const));
    for (const [file, target] of alertImports.filter(([, t]) => t.startsWith("modules/insurer-ops/") || t.startsWith("modules/processes/"))) {
      expect(target, `${file} só pela raiz`).toMatch(/^modules\/(insurer-ops|processes)\/index$/);
    }
    const read = (m: string, layer: string, f: string) => readFile(join(SRC_ROOT, "modules", m, layer, f), "utf8");
    expect(await read("insurer-ops", "application", "ports.ts")).toMatch(/export interface FamilyNotifier</);
    expect(await read("alerts", "application", "ports.ts")).toMatch(/export interface ProcessTargetsPort</);
    for (const [m, file] of [["processes", "derive-coverage-view"], ["insurer-ops", "coverage-phase"]] as const) {
      const found = files.find((f) => f.file === `modules/${m}/domain/${file}`);
      expect(found, file).toBeDefined();
      expect(found?.bareImports, file).toEqual([]);
      for (const target of found?.relativeImports ?? []) expect(target.startsWith(`modules/${m}/domain/`), `${file} -> ${target}`).toBe(true);
    }
    // R9: o aviso a 3 dias é uma constante de domínio num único sítio (sem literal `3` nos restantes ficheiros de `alerts`).
    const alertSources = ["application/scan-job.ts", "application/raise-authorization-event.ts", "application/list-alerts.ts", "domain/recipients.ts"];
    for (const target of alertSources) {
      const text = (await read("alerts", target.split("/")[0] ?? "", target.split("/")[1] ?? "")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
      expect(text, target).not.toMatch(/\b3\b/);
    }
  });

  it("TC-AUT-18: sem literais de prazo (48, 72, 15, 7) nos ficheiros do pedido de autorização", async () => {
    const targets = ["domain/authorization.ts", "domain/authorization-machine.ts", "domain/deadline.ts", "domain/coverage-phase.ts", "application/authorization-support.ts", "application/create-authorization.ts", "application/appeal-authorization.ts", "application/respond-authorization.ts", "application/submit-authorization.ts", "application/expire-info-requests.ts", "domain/auto-approval.ts", "domain/authorization-actions.ts", "domain/authorization-decision.ts", "domain/sla.ts", "application/insurer-authorization-support.ts", "application/approve-authorization.ts", "application/reopen-authorization.ts", "application/flag-sla-breaches.ts"];
    for (const target of targets) {
      const text = (await readFile(join(SRC_ROOT, "modules", "insurer-ops", target), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
      expect(text, target).not.toMatch(/\b(48|72|15|7)\b/);
    }
  });

  it("platform nunca importa de main ou de modules/*", async () => {
    const files = await collectImports(SRC_ROOT);
    const platformFiles = files.filter((f) => f.file.startsWith("platform/"));
    expect(platformFiles.length).toBeGreaterThan(0);
    for (const file of platformFiles) {
      for (const target of file.relativeImports) {
        expect(target.startsWith("main/") || target.startsWith("modules/")).toBe(false);
      }
    }
  });
});

// Um verificador de arquitetura que nunca falha é inútil: estes casos sintéticos provam que
// `checkArchitecture` deteta cada classe de violação, mesmo antes de existirem módulos reais.
describe("checkArchitecture (dados sintéticos)", () => {
  const deps = { users: ["audit"], audit: [], admin: ["users"], medications: [] };

  const cases: { name: string; files: FileImports[]; expectedSubstring: string }[] = [
    {
      name: "platform importa módulo",
      files: [{ file: "platform/x", relativeImports: ["modules/users/index"], bareImports: [] }],
      expectedSubstring: "platform não pode depender",
    },
    {
      name: "main importa camada interna de um módulo",
      files: [
        {
          file: "main/api",
          relativeImports: ["modules/users/application/register"],
          bareImports: [],
        },
      ],
      expectedSubstring: "main só importa a raiz",
    },
    {
      name: "admin importa módulo de saúde",
      files: [
        {
          file: "modules/admin/application/x",
          relativeImports: ["modules/medications/index"],
          bareImports: [],
        },
      ],
      expectedSubstring: "admin nunca importa",
    },
    {
      name: "dependência não declarada em modules.md",
      files: [
        {
          file: "modules/audit/application/x",
          relativeImports: ["modules/users/index"],
          bareImports: [],
        },
      ],
      expectedSubstring: "não pode depender de modules/users",
    },
    {
      name: "outro módulo importado por uma camada interna (não pela raiz)",
      files: [
        {
          file: "modules/users/application/x",
          relativeImports: ["modules/audit/application/y"],
          bareImports: [],
        },
      ],
      expectedSubstring: "só se importa pela raiz",
    },
    {
      name: "interface chama outro módulo diretamente",
      files: [
        {
          file: "modules/users/interface/x",
          relativeImports: ["modules/audit/index"],
          bareImports: [],
        },
      ],
      expectedSubstring: "só application e a raiz chamam outros módulos",
    },
    {
      name: "domain importa a camada application do mesmo módulo",
      files: [
        {
          file: "modules/users/domain/x",
          relativeImports: ["modules/users/application/y"],
          bareImports: [],
        },
      ],
      expectedSubstring: "camada domain não pode importar a camada application",
    },
    {
      name: "application importa infrastructure do mesmo módulo",
      files: [
        {
          file: "modules/users/application/x",
          relativeImports: ["modules/users/infrastructure/y"],
          bareImports: [],
        },
      ],
      expectedSubstring: "camada application não pode importar a camada infrastructure",
    },
    {
      name: "domain importa biblioteca de I/O",
      files: [{ file: "modules/users/domain/x", relativeImports: [], bareImports: ["kysely"] }],
      expectedSubstring: 'camada domain não pode importar "kysely"',
    },
    {
      name: "application importa express",
      files: [
        { file: "modules/users/application/x", relativeImports: [], bareImports: ["express"] },
      ],
      expectedSubstring: 'camada application não pode importar "express"',
    },
    {
      name: "interface importa pg diretamente",
      files: [{ file: "modules/users/interface/x", relativeImports: [], bareImports: ["pg"] }],
      expectedSubstring: 'camada interface não pode importar "pg"',
    },
    {
      name: "módulo desconhecido (não declarado em modules.md)",
      files: [{ file: "modules/foo/application/x", relativeImports: [], bareImports: [] }],
      expectedSubstring: "módulo desconhecido",
    },
  ];

  it.each(cases)("deteta: $name", ({ files, expectedSubstring }) => {
    const violations = checkArchitecture(files, deps);
    expect(violations.some((v) => v.includes(expectedSubstring))).toBe(true);
  });

  describe("módulo processes (TC-PRC-20, dependências reais de modules.md §2)", () => {
    const real: { name: string; files: FileImports[]; expectedSubstring: string }[] = [
      { name: "processes importa appointments", files: [{ file: "modules/processes/application/x", relativeImports: ["modules/appointments/index"], bareImports: [] }], expectedSubstring: "não pode depender de modules/appointments" },
      { name: "appointments importa processes", files: [{ file: "modules/appointments/application/x", relativeImports: ["modules/processes/index"], bareImports: [] }], expectedSubstring: "não pode depender de modules/processes" },
      { name: "examinations importa processes", files: [{ file: "modules/examinations/application/x", relativeImports: ["modules/processes/index"], bareImports: [] }], expectedSubstring: "não pode depender de modules/processes" },
      { name: "processes/domain importa platform (Clock)", files: [{ file: "modules/processes/domain/x", relativeImports: ["platform/clock/index"], bareImports: [] }], expectedSubstring: "só importa o próprio domain" },
      { name: "processes/domain importa um pacote", files: [{ file: "modules/processes/domain/x", relativeImports: [], bareImports: ["zod"] }], expectedSubstring: "não importa pacotes" },
    ];
    it.each(real)("deteta: $name", ({ files, expectedSubstring }) => {
      expect(checkArchitecture(files).some((v) => v.includes(expectedSubstring))).toBe(true);
    });

    it("aceita o que o contrato permite: processes -> access/audit pela raiz e main -> processes", () => {
      const files: FileImports[] = [
        { file: "modules/processes/application/x", relativeImports: ["modules/access/index", "modules/audit/index", "modules/processes/domain/process"], bareImports: [] },
        { file: "modules/processes/domain/derive", relativeImports: ["modules/processes/domain/process"], bareImports: [] },
        { file: "main/api", relativeImports: ["modules/processes/index"], bareImports: [] },
      ];
      expect(checkArchitecture(files)).toEqual([]);
    });
  });

  it("deteta ciclos de dependência entre módulos", () => {
    const cyclicDeps = { a: ["b"], b: ["a"] };
    const files: FileImports[] = [
      { file: "modules/a/application/x", relativeImports: ["modules/b/index"], bareImports: [] },
      { file: "modules/b/application/x", relativeImports: ["modules/a/index"], bareImports: [] },
    ];
    const violations = checkArchitecture(files, cyclicDeps);
    expect(violations.some((v) => v.includes("ciclo"))).toBe(true);
  });

  it("não produz falsos positivos para um grafo conforme", () => {
    const files: FileImports[] = [
      {
        file: "modules/users/infrastructure/repo",
        relativeImports: ["modules/users/domain/user"],
        bareImports: ["kysely"],
      },
      {
        file: "modules/users/application/ports",
        relativeImports: ["modules/users/domain/user"],
        bareImports: [],
      },
      {
        // Ficheiro irmão do mesmo módulo/camada (ex.: um caso de uso a importar `ports.ts`) tem de
        // ser permitido — regressão do bug corrigido em LAYER_DEPENDENCIES (M1).
        file: "modules/users/application/register",
        relativeImports: [
          "modules/users/domain/user",
          "modules/users/application/ports",
          "modules/audit/index",
        ],
        bareImports: [],
      },
      {
        file: "modules/users/interface/controller",
        relativeImports: ["modules/users/application/register"],
        bareImports: ["express"],
      },
      {
        file: "modules/users/index",
        relativeImports: [
          "modules/users/application/register",
          "modules/users/infrastructure/repo",
          "modules/users/interface/controller",
        ],
        bareImports: [],
      },
      {
        file: "main/api",
        relativeImports: ["modules/users/index", "platform/http/index"],
        bareImports: [],
      },
    ];
    expect(checkArchitecture(files, deps)).toEqual([]);
  });
});

describe("clinic-patients (ADR-026, modules.md §2 nota 24)", () => {
  const files = (target: string): FileImports[] => [{ file: "modules/clinic-patients/application/x", relativeImports: [target], bareImports: [] }];

  it.each(["medications", "examinations", "appointments", "recommendations", "families", "auth"])("não pode importar modules/%s (só por portas no composition root)", (module) => {
    expect(checkArchitecture(files(`modules/${module}/index`)).join("\n")).toContain(`não pode depender de modules/${module}`);
  });

  it.each(["access", "clinics", "audit"])("pode importar a raiz de modules/%s", (module) => {
    expect(checkArchitecture(files(`modules/${module}/index`))).toEqual([]);
  });
});

describe("clinic-receipts (ADR-026, modules.md §2 nota 26)", () => {
  const files = (target: string, from = "modules/clinic-receipts/application/x"): FileImports[] => [{ file: from, relativeImports: [target], bareImports: [] }];

  it.each(["medications", "examinations", "appointments", "recommendations", "clinic-patients", "families", "auth", "insurance", "documents"])("não pode importar modules/%s (só por portas no composition root)", (module) => {
    expect(checkArchitecture(files(`modules/${module}/index`)).join("\n")).toContain(`não pode depender de modules/${module}`);
  });

  it.each(["access", "audit"])("pode importar a raiz de modules/%s", (module) => {
    expect(checkArchitecture(files(`modules/${module}/index`))).toEqual([]);
  });

  it("insurance não pode importar clinic-receipts (só a porta ClinicReceiptLookup)", () => {
    expect(checkArchitecture(files("modules/clinic-receipts/index", "modules/insurance/application/x")).join("\n")).toContain("não pode depender de modules/clinic-receipts");
  });

  it("audit continua sem importar módulos de negócio (a auditoria da clínica é só uma consulta)", () => {
    expect(checkArchitecture(files("modules/clinics/index", "modules/audit/application/x")).join("\n")).toContain("não pode depender de modules/clinics");
  });
});

describe("clinic-reports (ADR-027/ADR-028, modules.md §2 notas 27/28)", () => {
  const files = (target: string, from = "modules/clinic-reports/application/x"): FileImports[] => [{ file: from, relativeImports: [target], bareImports: [] }];

  it.each(["auth", "access", "families", "insurance", "clinic-receipts", "clinic-patients", "medications", "examinations", "appointments", "recommendations", "documents"])("não pode importar modules/%s (só por portas no composition root)", (module) => {
    expect(checkArchitecture(files(`modules/${module}/index`)).join("\n")).toContain(`não pode depender de modules/${module}`);
  });

  it.each(["clinics", "audit"])("pode importar a raiz de modules/%s", (module) => {
    expect(checkArchitecture(files(`modules/${module}/index`))).toEqual([]);
  });

  it.each(["appointments", "examinations", "alerts"])("modules/%s não pode importar clinic-reports (só as portas ConsultationReportFinalizer/ExamReportGenerator/ExamOrderLinker/ExamOrderAlerts)", (module) => {
    expect(checkArchitecture(files("modules/clinic-reports/index", `modules/${module}/application/x`)).join("\n")).toContain("não pode depender de modules/clinic-reports");
  });

  it("modules/lifecycle e modules/clinics também não podem importar clinic-reports (exportação e matriz entram por portas/dados)", () => {
    for (const module of ["lifecycle", "clinics"]) {
      expect(checkArchitecture(files("modules/clinic-reports/index", `modules/${module}/application/x`)).join("\n")).toContain("não pode depender de modules/clinic-reports");
    }
  });

  it("a application não pode importar pdfkit nem kysely (só a infrastructure desenha/persiste)", () => {
    const violations = checkArchitecture([{ file: "modules/clinic-reports/application/x", relativeImports: [], bareImports: ["pdfkit", "kysely"] }]).join("\n");
    expect(violations).toContain("kysely");
    expect(violations).toContain("pdfkit");
  });
});
