// RL8 (ADR-038): fronteiras dos limitadores. Nenhum módulo importa adaptadores/limitador síncrono nem mantém um
// limitador local; `ioredis`/`redis` só em `platform/rate-limit/infrastructure`; a composição de produção não
// instancia o adaptador em memória.
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectImports } from "./collect-imports.js";

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const isTestSupport = (file: string): boolean => /(\.test|\/contract|\/fixtures)$/.test(file);
const read = (file: string): Promise<string> => readFile(join(SRC_ROOT, `${file}.ts`), "utf8");

describe("limitadores de taxa: arquitetura (RL8, ADR-038)", () => {
  it("nenhum módulo importa adaptadores/núcleo (in-memory, failing, limiter, keys, infrastructure) fora de testes e fixtures", async () => {
    const files = await collectImports(SRC_ROOT);
    const forbidden = /^platform\/rate-limit\/(in-memory|failing|limiter|keys|factory|infrastructure\/.*)$/;
    for (const file of files.filter((f) => f.file.startsWith("modules/") && !isTestSupport(f.file))) {
      expect(file.relativeImports.filter((t) => forbidden.test(t)), file.file).toEqual([]);
    }
  });

  it("o barrel `platform/rate-limit/index` só exporta a porta (sem limitador síncrono, sem adaptadores de teste)", async () => {
    const index = await read("platform/rate-limit/index");
    expect(index).not.toMatch(/class\s+InMemoryRateLimiter|class\s+FailingRateLimiter|consume\(key: string/);
    expect(index.split("\n").filter((l) => l.startsWith("export") || l.startsWith("import")).join("\n")).not.toMatch(/in-memory|failing|infrastructure/);
    const port = await read("platform/rate-limit/port");
    expect(port).toMatch(/consume\([^)]*\):\s*Promise</);
    expect(port).not.toMatch(/consume\(key: string, rule: RateLimitRule\): RateLimitDecision/);
  });

  it("`InMemoryRateLimiter`/`FailingRateLimiter` só em testes, fixtures e na composição (main/api); `ClosedRateLimiter` também no default dos módulos", async () => {
    const files = await collectImports(SRC_ROOT);
    for (const file of files) {
      if (isTestSupport(file.file) || file.file.startsWith("platform/rate-limit/")) {
        continue;
      }
      const text = await read(file.file);
      if (/\b(InMemoryRateLimiter|FailingRateLimiter)\b/.test(text)) {
        expect(file.file, "InMemory/Failing fora de testes e da composição").toBe("main/api");
      }
    }
    const api = await read("main/api");
    // A composição de produção só usa o InMemory via `createRateLimiting` (recusado em produção pela config).
    expect(api).not.toMatch(/new InMemoryRateLimiter|new FailingRateLimiter/);
  });

  it("`ioredis`/`redis` só em platform/rate-limit/infrastructure", async () => {
    const files = await collectImports(SRC_ROOT);
    for (const file of files) {
      if (!file.file.startsWith("platform/rate-limit/infrastructure/")) {
        expect(file.bareImports.filter((p) => p === "ioredis" || p === "redis" || p.startsWith("ioredis/") || p.startsWith("redis/")), file.file).toEqual([]);
      }
    }
  });

  it("nenhum módulo mantém um limitador local (classe/interface `*RateLimiter`, janela deslizante em Map)", async () => {
    const files = (await collectImports(SRC_ROOT)).filter((f) => f.file.startsWith("modules/") && !isTestSupport(f.file));
    for (const file of files) {
      const text = await read(file.file);
      expect(text, `${file.file}: classe de limitador local`).not.toMatch(/\bclass\s+\w*(RateLimit|Limiter)\w*/);
      expect(text, `${file.file}: interface de limitador local`).not.toMatch(/\binterface\s+\w*(RateLimiter|Limiter)\b/);
      expect(text, `${file.file}: janela deslizante manual`).not.toMatch(/new Map<string,\s*number\[\]>/);
    }
  });

  it("nenhum ficheiro de produção reintroduz o limitador síncrono (`consume(...)` sem await sobre RateLimitDecision)", async () => {
    const dirs = ["modules", "platform", "main"];
    const walk = async (dir: string): Promise<string[]> => {
      const out: string[] = [];
      for (const entry of await readdir(join(SRC_ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          out.push(...(await walk(rel)));
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
          out.push(rel.replace(/\.ts$/, ""));
        }
      }
      return out;
    };
    for (const dir of dirs) {
      for (const file of await walk(dir)) {
        if (file.startsWith("platform/rate-limit/") || isTestSupport(file)) {
          continue;
        }
        const text = await read(file);
        const unawaited = text.split("\n").filter((l) => /\b\w*(?:[lL]imiter|limiter)\.(consume|peek|reset)\(/.test(l) && !/await |return |\.then|=> *\w*(?:[lL]imiter)/.test(l));
        expect(unawaited, `${file}: chamada ao limitador sem await`).toEqual([]);
      }
    }
  });
});
