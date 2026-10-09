import { describe, expect, it } from "vitest";
import { InMemoryStorage } from "./index.js";

async function readAll(stream: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

describe("InMemoryStorage", () => {
  it("devolve o conteúdo guardado por putObject em getObject", async () => {
    const storage = new InMemoryStorage();
    await storage.putObject("quarantine/doc-1", Buffer.from("conteúdo"), "application/pdf");

    const stream = await storage.getObject("quarantine/doc-1");
    expect(await readAll(stream)).toBe("conteúdo");
  });

  it("lança ao ler uma chave inexistente", async () => {
    const storage = new InMemoryStorage();
    await expect(storage.getObject("nope")).rejects.toThrow();
  });

  it("copyObject duplica o conteúdo para a chave final (saída de quarentena)", async () => {
    const storage = new InMemoryStorage();
    await storage.putObject("quarantine/doc-1", Buffer.from("x"), "application/pdf");
    await storage.copyObject("quarantine/doc-1", "documents/doc-1");

    const stream = await storage.getObject("documents/doc-1");
    expect(await readAll(stream)).toBe("x");
  });

  it("deleteObject remove a chave", async () => {
    const storage = new InMemoryStorage();
    await storage.putObject("k", Buffer.from("x"), "application/pdf");
    await storage.deleteObject("k");
    await expect(storage.getObject("k")).rejects.toThrow();
  });
});
