// Regras de arquitetura (puras, sem I/O) — equivalente ao `internal/arch_test.go` do ADR-013,
// adaptado à estrutura de ADR-015: `platform` (kit técnico) / `main` (composition root) /
// `modules/<m>/{domain,application,infrastructure,interface}` (Clean Architecture).
// Fonte das dependências entre módulos: docs/06-architecture/modules.md §2-3.

export type Layer = "domain" | "application" | "infrastructure" | "interface" | "root";

export interface FileImports {
  /** Caminho do ficheiro relativo a `src/`, sem extensão (ex.: `modules/users/application/register`). */
  file: string;
  /** Imports relativos já resolvidos para o mesmo formato (sem extensão). */
  relativeImports: string[];
  /** Nomes de pacotes de `node_modules` importados (sem builtins `node:`). */
  bareImports: string[];
}

type Location =
  | { kind: "platform" }
  | { kind: "main" }
  | { kind: "generated" }
  | { kind: "module"; module: string; layer: Layer }
  | { kind: "other" };

/** Módulos de registos de saúde — `admin` nunca os importa (modules.md §3.4, NFR-SEC-10). */
export const HEALTH_MODULES = [
  "health-records",
  "prescriptions",
  "medications",
  "appointments",
  "examinations",
  "documents",
];

/** Dependências por módulo (API pública) — modules.md §2. `platform` = "common" nessa tabela. */
export const MODULE_DEPENDENCIES: Record<string, string[]> = {
  audit: [],
  users: ["audit"],
  // auth -> families é intencional e unidirecional (UC-MEM-05/BR-MEM-12/13/17; modules.md §3.7).
  auth: ["users", "notifications", "audit", "families"],
  families: ["users", "audit", "notifications"],
  // access -> audit é intencional (modules.md §3.8): regista SHARING_UPDATE na mesma transação.
  access: ["families", "audit"],
  // health-records -> families (modules.md §3 nota 9): blood_type vive em family_members
  // (schema.md §2); health-records só pode lê-lo/escrevê-lo pela API pública de families
  // (getBloodType/setBloodType), nunca pela tabela diretamente (conventions.md §3.5).
  "health-records": ["access", "audit", "families"],
  prescriptions: ["access", "medications", "documents", "audit"],
  medications: ["access", "audit"],
  appointments: ["access", "clinics", "audit"],
  clinics: ["access"],
  examinations: ["access", "clinics", "documents", "audit"],
  documents: ["access", "audit"],
  alerts: ["medications", "appointments", "examinations", "families"],
  notifications: ["users"],
  reports: [
    "access",
    "health-records",
    "prescriptions",
    "medications",
    "appointments",
    "clinics",
    "examinations",
    "documents",
  ],
  lifecycle: ["families", "documents", "notifications", "audit"],
  admin: ["users", "clinics", "audit"],
};

/**
 * Que camadas do MESMO módulo cada camada pode importar — inclui sempre a própria camada (ficheiros
 * irmãos dentro de `application/`, por exemplo um caso de uso a importar `ports.ts`, são normais em
 * Clean Architecture e não violam nenhuma fronteira do ADR-015/conventions.md §1).
 */
const LAYER_DEPENDENCIES: Record<Layer, Layer[]> = {
  domain: ["domain"],
  application: ["domain", "application"],
  infrastructure: ["application", "domain", "infrastructure"],
  interface: ["application", "domain", "interface"],
  root: ["domain", "application", "infrastructure", "interface", "root"],
};

/** Pacotes de I/O que `domain`/`application` nunca podem importar (conventions.md §3.9). */
const IO_PACKAGES_BANNED_IN_DOMAIN_AND_APPLICATION = [
  "express",
  "express-openapi-validator",
  "kysely",
  "pg",
  "pg-boss",
  "minio",
  "nodemailer",
  "web-push",
  "clamd",
];

/** `interface` liga ao contrato/HTTP, mas não acede a dados/filas/storage diretamente. */
const IO_PACKAGES_BANNED_IN_INTERFACE = [
  "kysely",
  "pg",
  "pg-boss",
  "minio",
  "nodemailer",
  "web-push",
  "clamd",
];

function locate(path: string): Location {
  if (path === "platform" || path.startsWith("platform/")) {
    return { kind: "platform" };
  }
  if (path === "main" || path.startsWith("main/")) {
    return { kind: "main" };
  }
  if (path === "generated" || path.startsWith("generated/")) {
    return { kind: "generated" };
  }
  if (path.startsWith("modules/")) {
    const parts = path.split("/");
    const moduleName = parts[1];
    if (!moduleName) {
      return { kind: "other" };
    }
    if (parts.length <= 2 || (parts.length === 3 && parts[2] === "index")) {
      return { kind: "module", module: moduleName, layer: "root" };
    }
    const layer = (parts[2] ?? "root") as Layer;
    return { kind: "module", module: moduleName, layer };
  }
  return { kind: "other" };
}

function detectCycles(graph: Map<string, Set<string>>): string[] {
  const violations: string[] = [];
  const state = new Map<string, 0 | 1 | 2>();

  function visit(node: string, path: string[]): void {
    state.set(node, 1);
    const next = [...(graph.get(node) ?? [])].sort();
    for (const target of next) {
      const targetState = state.get(target) ?? 0;
      if (targetState === 0) {
        visit(target, [...path, target]);
      } else if (targetState === 1) {
        violations.push(`ciclo de dependências: ${[...path, target].join(" -> ")}`);
      }
    }
    state.set(node, 2);
  }

  for (const node of [...graph.keys()].sort()) {
    if ((state.get(node) ?? 0) === 0) {
      visit(node, [node]);
    }
  }
  return violations;
}

function addEdge(graph: Map<string, Set<string>>, from: string, to: string): void {
  let targets = graph.get(from);
  if (!targets) {
    targets = new Set<string>();
    graph.set(from, targets);
  }
  targets.add(to);
}

/**
 * Verifica o grafo de imports (já recolhido por `collectImports`) contra as regras de arquitetura;
 * devolve a lista de violações (vazia = conforme). `moduleDependencies` é injetável para os testes
 * que provam que o verificador deteta violações (ver architecture.test.ts).
 */
export function checkArchitecture(
  files: FileImports[],
  moduleDependencies: Record<string, string[]> = MODULE_DEPENDENCIES,
): string[] {
  const violations: string[] = [];
  const graph = new Map<string, Set<string>>();

  for (const file of files) {
    const from = locate(file.file);

    if (from.kind === "module" && !(from.module in moduleDependencies)) {
      violations.push(
        `módulo desconhecido modules/${from.module} (declarar em architecture-rules.ts e modules.md)`,
      );
      continue;
    }

    for (const bareImport of file.bareImports) {
      if (
        from.kind === "module" &&
        (from.layer === "domain" || from.layer === "application") &&
        IO_PACKAGES_BANNED_IN_DOMAIN_AND_APPLICATION.includes(bareImport)
      ) {
        violations.push(
          `${file.file}: camada ${from.layer} não pode importar "${bareImport}" (I/O)`,
        );
      }
      if (
        from.kind === "module" &&
        from.layer === "interface" &&
        IO_PACKAGES_BANNED_IN_INTERFACE.includes(bareImport)
      ) {
        violations.push(`${file.file}: camada interface não pode importar "${bareImport}" (I/O)`);
      }
      if (from.kind === "platform" && bareImport.startsWith("modules/")) {
        violations.push(`${file.file}: platform não pode depender de módulos`);
      }
    }

    for (const target of file.relativeImports) {
      const to = locate(target);

      if (from.kind === "platform") {
        if (to.kind === "module" || to.kind === "main") {
          violations.push(
            `${file.file}: platform não pode depender de módulos/main (importa ${target})`,
          );
        }
        continue;
      }

      if (from.kind === "main") {
        if (to.kind === "module" && to.layer !== "root") {
          violations.push(`${file.file}: main só importa a raiz dos módulos (importa ${target})`);
        }
        continue;
      }

      if (from.kind !== "module") {
        continue;
      }

      if (to.kind === "main") {
        violations.push(`${file.file}: módulos não dependem de main`);
        continue;
      }

      if (to.kind !== "module") {
        continue;
      }

      if (to.module === from.module) {
        const allowedSame = from.layer === "root" && to.layer === "root";
        if (!allowedSame && !LAYER_DEPENDENCIES[from.layer].includes(to.layer)) {
          violations.push(
            `${file.file}: camada ${from.layer} não pode importar a camada ${to.layer}`,
          );
        }
        continue;
      }

      // Outro módulo: só pela raiz, só de application/root, só se declarado, nunca ciclos.
      if (to.layer !== "root") {
        violations.push(`${file.file}: outro módulo só se importa pela raiz (importa ${target})`);
      }
      if (from.layer !== "application" && from.layer !== "root") {
        violations.push(`${file.file}: só application e a raiz chamam outros módulos`);
      }
      if (!moduleDependencies[from.module]?.includes(to.module)) {
        violations.push(
          `${file.file}: modules/${from.module} não pode depender de modules/${to.module} (modules.md §2)`,
        );
      }
      if (from.module === "admin" && HEALTH_MODULES.includes(to.module)) {
        violations.push(`${file.file}: admin nunca importa módulos de saúde`);
      }

      addEdge(graph, from.module, to.module);
    }
  }

  return [...violations, ...detectCycles(graph)];
}
