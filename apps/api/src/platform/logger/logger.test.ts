import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { Secret, createLogger } from "./index.js";

function captureLines(): { stream: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc: BufferEncoding, callback: (error?: Error | null) => void) {
      chunks.push(chunk.toString("utf8"));
      callback();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join("")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

describe("createLogger", () => {
  it("redige campos sensíveis de primeiro nível (password)", () => {
    const { stream, lines } = captureLines();
    const logger = createLogger({ destination: stream });
    logger.info({ password: "segredo123" }, "login");
    const [entry] = lines();
    expect(entry?.password).toBe("[REDACTED]");
  });

  it("redige campos sensíveis um nível dentro de um objeto aninhado (*.token)", () => {
    const { stream, lines } = captureLines();
    const logger = createLogger({ destination: stream });
    logger.info({ session: { token: "abc.def.ghi" } }, "refresh");
    const [entry] = lines();
    const session = entry?.session as Record<string, unknown> | undefined;
    expect(session?.token).toBe("[REDACTED]");
  });

  it("redige dados de saúde marcados (ex.: diagnosis)", () => {
    const { stream, lines } = captureLines();
    const logger = createLogger({ destination: stream });
    logger.info({ diagnosis: "hipertensão" }, "evento");
    const [entry] = lines();
    expect(entry?.diagnosis).toBe("[REDACTED]");
  });

  it("aceita caminhos de redação adicionais passados pelo chamador", () => {
    const { stream, lines } = captureLines();
    const logger = createLogger({ destination: stream, redactPaths: ["customSecret"] });
    logger.info({ customSecret: "x" }, "evento");
    const [entry] = lines();
    expect(entry?.customSecret).toBe("[REDACTED]");
  });

  it("não redige campos não sensíveis", () => {
    const { stream, lines } = captureLines();
    const logger = createLogger({ destination: stream });
    logger.info({ requestId: "req-1", status: 200 }, "http");
    const [entry] = lines();
    expect(entry?.requestId).toBe("req-1");
    expect(entry?.status).toBe(200);
  });
});

describe("Secret", () => {
  it("nunca expõe o valor original quando serializado", () => {
    const secret = new Secret("valor-real");
    const json = JSON.stringify({ apiKey: secret });
    expect(json).toContain("[REDACTED]");
    expect(json).not.toContain("valor-real");
  });

  it("reveal() devolve o valor original para uso interno (nunca para logs)", () => {
    const secret = new Secret("valor-real");
    expect(secret.reveal()).toBe("valor-real");
  });

  it("redige detail/where/parameters (e equivalentes) de erros do driver pg, também em cause; mantém message/code/constraint", () => {
    const { stream, lines } = captureLines();
    const logger = createLogger({ destination: stream });
    const pgErr = Object.assign(new Error('duplicate key value violates unique constraint "users_email_key"'), {
      code: "23505",
      constraint: "users_email_key",
      detail: "Key (email)=(CANARIO@exemplo.pt) already exists.",
      where: "SQL statement com CANARIO-WHERE",
      parameters: ["CANARIO-PARAM"],
      hint: "CANARIO-HINT",
    });
    const wrapper = new Error("wrapper", { cause: pgErr });
    logger.error({ err: pgErr }, "db_error");
    logger.error({ err: wrapper }, "db_error_wrapped");
    const raw = JSON.stringify(lines());
    for (const canary of ["CANARIO@exemplo.pt", "CANARIO-WHERE", "CANARIO-PARAM", "CANARIO-HINT"]) expect(raw).not.toContain(canary);
    const [first] = lines();
    expect(first?.err).toMatchObject({ code: "23505", constraint: "users_email_key", detail: "[REDACTED]", where: "[REDACTED]", parameters: "[REDACTED]" });
    expect(JSON.stringify(first?.err)).toContain("users_email_key");
  });
});
