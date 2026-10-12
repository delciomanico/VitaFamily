import { describe, expect, it } from "vitest";
import { crc32, createZip } from "./zip.js";

describe("zip (stored)", () => {
  it("crc32 de referência", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });

  it("escreve cabeçalhos válidos e conteúdo intacto", () => {
    const zip = createZip(
      [
        { name: "dados.json", data: Buffer.from('{"ok":true}') },
        { name: "documentos/acentuação.pdf", data: Buffer.from("%PDF") },
      ],
      new Date("2026-10-12T10:00:00Z"),
    );
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(2);
    expect(zip.includes(Buffer.from('{"ok":true}'))).toBe(true);
    expect(zip.includes(Buffer.from("documentos/acentuação.pdf"))).toBe(true);
  });

  it("o diretório central aponta para o início de cada entrada", () => {
    const zip = createZip([{ name: "a.txt", data: Buffer.from("aaa") }, { name: "b.txt", data: Buffer.from("bbbb") }], new Date("2026-01-01T00:00:00Z"));
    const centralOffset = zip.readUInt32LE(zip.length - 22 + 16);
    expect(zip.readUInt32LE(centralOffset)).toBe(0x02014b50);
    const first = zip.readUInt32LE(centralOffset + 42);
    expect(first).toBe(0);
    const nameLength = zip.readUInt16LE(centralOffset + 28);
    const second = zip.readUInt32LE(centralOffset + 46 + nameLength + 42);
    expect(zip.readUInt32LE(second)).toBe(0x04034b50);
    expect(second).toBe(30 + 5 + 3);
  });
});
