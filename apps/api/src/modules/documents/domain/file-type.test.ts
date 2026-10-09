import { describe, expect, it } from "vitest";
import { detectFileKind, mimeTypeForFileKind } from "./file-type.js";

describe("detectFileKind", () => {
  it.each([
    ["PDF", Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])],
    ["JPG", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])],
    ["PNG", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])],
  ] as const)("reconhece %s pelos magic bytes", (kind, buffer) => {
    expect(detectFileKind(buffer)).toBe(kind);
  });

  it("devolve null para um executável disfarçado de .pdf (AC-DOC-03)", () => {
    const exeHeader = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // "MZ" (PE/EXE)
    expect(detectFileKind(exeHeader)).toBeNull();
  });

  it("devolve null para texto simples (ex.: EICAR em bruto, sem contentor válido)", () => {
    expect(detectFileKind(Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR"))).toBeNull();
  });

  it("devolve null para buffer vazio ou mais curto do que a assinatura", () => {
    expect(detectFileKind(Buffer.alloc(0))).toBeNull();
    expect(detectFileKind(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  it.each([
    ["PDF", "application/pdf"],
    ["JPG", "image/jpeg"],
    ["PNG", "image/png"],
  ] as const)("mimeTypeForFileKind(%s) -> %s", (kind, mime) => {
    expect(mimeTypeForFileKind(kind)).toBe(mime);
  });
});
