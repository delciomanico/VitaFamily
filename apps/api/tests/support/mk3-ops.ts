// Utilitários partilhados pelos testes de conformidade/segurança de MK3 (S13): inventário de operações lido do `openapi.yaml`,
// leitor de corpos binários e PDF mínimo válido. Só leitura do contrato; sem lógica de negócio.
import { MK4_OPERATION_IDS } from "./mk4-pending.js";

export type Method = "get" | "post" | "put" | "patch" | "delete";
export interface Op {
  id: string;
  method: Method;
  path: string;
}

/** Operações de `paths` (indentação do contrato: caminhos a 2 espaços, métodos a 4, operationId a 6). */
export function parseAllOps(text: string): Op[] {
  const ops: Op[] = [];
  let inPaths = false;
  let path: string | null = null;
  let method: Method | null = null;
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
      method = null;
      continue;
    }
    const m = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    if (m) {
      method = m[1] as Method;
      continue;
    }
    const id = /^ {6}operationId: (\w+)/.exec(line);
    if (id && path !== null && method !== null && !MK4_OPERATION_IDS.has(id[1] ?? "")) ops.push({ id: id[1] ?? "", method, path });
  }
  return ops;
}

/** Corpo binário: devolve `Buffer` (ficheiros) ou o JSON de erro. */
export const binaryParser = (res: NodeJS.ReadableStream & { headers: Record<string, string | undefined> }, callback: (err: Error | null, body: unknown) => void): void => {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => {
    const body = Buffer.concat(chunks);
    callback(null, res.headers["content-type"]?.includes("json") ? (JSON.parse(body.toString("utf8")) as unknown) : body);
  });
};

/** Conteúdo PDF válido (assinatura `%PDF-`) com uma marca para distinguir ficheiros. */
export const pdf = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n${tag}\n%%EOF\n`, "utf8");
