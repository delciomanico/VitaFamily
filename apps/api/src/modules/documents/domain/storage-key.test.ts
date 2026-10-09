import { describe, expect, it } from "vitest";
import { finalStorageKey, quarantineStorageKey } from "./storage-key.js";

describe("storage-key", () => {
  it("usa o prefixo quarantine/ antes do antivírus aprovar (ADR-006)", () => {
    expect(quarantineStorageKey("doc-1", "PDF")).toBe("quarantine/doc-1.pdf");
  });

  it("usa o prefixo documents/ depois de CLEAN", () => {
    expect(finalStorageKey("doc-1", "JPG")).toBe("documents/doc-1.jpg");
  });

  it("nunca deriva da originalName (evita travessia de caminho)", () => {
    // A assinatura nem aceita `originalName` — só `documentId` (UUID) e o tipo detetado.
    expect(quarantineStorageKey("../../etc/passwd", "PNG")).toBe("quarantine/../../etc/passwd.png");
    // Nota: a proteção real é `documentId` vir sempre de `newId()` (UUID), nunca de entrada do
    // cliente — este teste só documenta que a função em si não tenta sanitizar o argumento.
  });
});
