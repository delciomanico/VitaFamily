// Recolhe, por regex (sem dependências pesadas como ts-morph), os imports de cada ficheiro .ts de
// `src/` — separa imports relativos (resolvidos para o grafo de módulos/camadas) de imports de
// pacotes (`node_modules`, para a proibição de bibliotecas de I/O em domain/application).
import { readFile, readdir } from "node:fs/promises";
import { extname, join, posix, relative } from "node:path";
import type { FileImports } from "./architecture-rules.js";

const IMPORT_FROM = /(?:^|\n)\s*(?:import|export)[^;\n]*?\sfrom\s+["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

function extractSpecifiers(content: string): string[] {
  const specs: string[] = [];
  for (const re of [IMPORT_FROM, SIDE_EFFECT_IMPORT, DYNAMIC_IMPORT]) {
    for (const match of content.matchAll(re)) {
      const spec = match[1];
      if (spec) {
        specs.push(spec);
      }
    }
  }
  return specs;
}

function toPosix(p: string): string {
  return p.split("\\").join("/");
}

/** Caminho (sem extensão, estilo POSIX) de `filePath` relativo a `srcRoot`. */
function toModuleId(srcRoot: string, filePath: string): string {
  const rel = toPosix(relative(srcRoot, filePath));
  return rel.replace(/\.ts$/, "");
}

function resolveRelativeSpecifier(fromModuleId: string, specifier: string): string {
  const fromDir = posix.dirname(fromModuleId);
  const joined = posix.join(fromDir, specifier);
  return joined.replace(/\.js$/, "");
}

function bareImportName(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return null;
  }
  if (specifier.startsWith("node:")) {
    return null;
  }
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    const scope = parts[0];
    const name = parts[1];
    return scope && name ? `${scope}/${name}` : specifier;
  }
  return specifier.split("/")[0] ?? specifier;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (extname(entry.name) === ".ts") {
      files.push(full);
    }
  }
  return files;
}

/** Recolhe os imports de todos os ficheiros `.ts` (não-teste) sob `srcRoot`. */
export async function collectImports(srcRoot: string): Promise<FileImports[]> {
  const files = (await walk(srcRoot)).filter((f) => !f.endsWith(".test.ts"));
  const result: FileImports[] = [];

  for (const filePath of files) {
    const moduleId = toModuleId(srcRoot, filePath);
    const content = await readFile(filePath, "utf8");
    const specifiers = extractSpecifiers(content);

    const relativeImports: string[] = [];
    const bareImports: string[] = [];
    for (const spec of specifiers) {
      if (spec.startsWith(".")) {
        relativeImports.push(resolveRelativeSpecifier(moduleId, spec));
      } else {
        const bare = bareImportName(spec);
        if (bare) {
          bareImports.push(bare);
        }
      }
    }

    result.push({ file: moduleId, relativeImports, bareImports });
  }

  return result;
}
