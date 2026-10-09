import { describe, expect, it } from "vitest";
import { sha256Hex } from "./checksum.js";

describe("sha256Hex", () => {
  it("calcula o SHA-256 em hexadecimal", () => {
    // echo -n "vita" | sha256sum
    expect(sha256Hex(Buffer.from("vita"))).toBe(
      "d25b82cf0233fff4ad6581909f092c815ed4a4a454dc94b4bcf6bb830963d591",
    );
  });

  it("é determinístico para o mesmo conteúdo", () => {
    const buffer = Buffer.from("conteúdo repetido");
    expect(sha256Hex(buffer)).toBe(sha256Hex(Buffer.from(buffer)));
  });

  it("muda com o conteúdo", () => {
    expect(sha256Hex(Buffer.from("a"))).not.toBe(sha256Hex(Buffer.from("b")));
  });
});
