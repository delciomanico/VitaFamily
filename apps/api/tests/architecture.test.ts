// Teste de arquitetura (equivalente ao `arch_test.go` do ADR-013): o grafo de imports de `src/`
// tem de respeitar as fronteiras de camadas (ADR-015) e as dependências entre módulos
// (docs/06-architecture/modules.md §2-3). Em M0 só existe `platform`; a verificação por módulo
// fica pronta e provada (com dados sintéticos) para M1 em diante usar imediatamente.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkArchitecture, type FileImports } from "./architecture-rules.js";
import { collectImports } from "./collect-imports.js";

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

describe("arquitetura do código real (src/)", () => {
  it("não tem violações das regras de camadas/módulos", async () => {
    const files = await collectImports(SRC_ROOT);
    expect(files.length).toBeGreaterThan(0); // o scanner tem de encontrar ficheiros reais
    const violations = checkArchitecture(files);
    expect(violations).toEqual([]);
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
