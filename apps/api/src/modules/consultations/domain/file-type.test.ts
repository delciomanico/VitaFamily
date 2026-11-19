import { describe, expect, it } from "vitest";
import { detectFileKind, finalKey, quarantineKey } from "./file-type.js";

describe("detectFileKind (assinatura por conteúdo)", () => {
  it("deteta PDF pela assinatura %PDF-", () => {
    expect(detectFileKind(Buffer.from("%PDF-1.7\n%âãÏÓ\n"))).toBe("PDF");
  });

  it("deteta JPG pelos três primeiros bytes FF D8 FF", () => {
    expect(detectFileKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBe("JPG");
  });

  it("deteta PNG pela assinatura de 8 bytes", () => {
    expect(detectFileKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe("PNG");
  });

  it("devolve null para texto simples", () => {
    expect(detectFileKind(Buffer.from("olá, isto é texto"))).toBeNull();
  });

  it("devolve null para um executável (MZ)", () => {
    expect(detectFileKind(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]))).toBeNull();
  });

  it("devolve null para buffer vazio", () => {
    expect(detectFileKind(Buffer.alloc(0))).toBeNull();
  });

  it("devolve null quando o buffer é mais curto do que a assinatura", () => {
    expect(detectFileKind(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(detectFileKind(Buffer.from("%PDF"))).toBeNull();
  });

  it("ignora a extensão e o nome: só contam os bytes", () => {
    // Bytes de PDF guardados com extensão .jpg e nome enganador ⇒ continua a ser PDF.
    const pdfBytes = Buffer.from("%PDF-1.4 conteúdo");
    expect(detectFileKind(pdfBytes)).toBe("PDF");
    // Texto com extensão .pdf ⇒ continua a não ser nada.
    expect(detectFileKind(Buffer.from("isto não é um pdf"))).toBeNull();
  });
});

describe("chaves de armazenamento", () => {
  const proofId = "0b6f3c1e-2d4a-4f7e-9a51-8c2d7e9f1a20";

  it("quarentena por tipo, só com o id do comprovativo", () => {
    expect(quarantineKey(proofId, "PDF")).toBe(`consultation-proofs/quarantine/${proofId}.pdf`);
    expect(quarantineKey(proofId, "JPG")).toBe(`consultation-proofs/quarantine/${proofId}.jpg`);
    expect(quarantineKey(proofId, "PNG")).toBe(`consultation-proofs/quarantine/${proofId}.png`);
  });

  it("final por tipo, só com o id do comprovativo", () => {
    expect(finalKey(proofId, "PDF")).toBe(`consultation-proofs/final/${proofId}.pdf`);
    expect(finalKey(proofId, "JPG")).toBe(`consultation-proofs/final/${proofId}.jpg`);
    expect(finalKey(proofId, "PNG")).toBe(`consultation-proofs/final/${proofId}.png`);
  });

  it("nunca contêm nomes de ficheiro (só prefixo, id e extensão)", () => {
    for (const key of [quarantineKey(proofId, "PDF"), finalKey(proofId, "PNG")]) {
      expect(key).toMatch(/^consultation-proofs\/(quarantine|final)\/[^/]+\.(pdf|jpg|png)$/);
      expect(key).not.toMatch(/\s/);
    }
  });
});
