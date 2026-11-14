import { describe, expect, it } from "vitest";
import { ValidationError } from "../../../platform/errors/index.js";
import { CLAIM_CODE_ALPHABET, CLAIM_CODE_LENGTH, CLAIM_CODE_TTL_MS, formatClaimCode, generateCardNumber, generateClaimCode, hashClaimCode } from "./beneficiary.js";
import { parseClaimRequest } from "./card-claim.js";
import { MAX_IMPORT_BYTES } from "./import-file.js";

const INSURER = "2bdba33b-9564-465b-8d0c-1977591fadc8";

describe("parseClaimRequest (BR-SEG-20)", () => {
  it("aceita apólice + código e normaliza o uuid", () => {
    expect(parseClaimRequest({ insurerId: INSURER.toUpperCase(), policyNumber: "  AP-1 ", code: "abcd-efgh" })).toEqual({ insurerId: INSURER, policyNumber: "AP-1", code: "abcd-efgh" });
  });

  it.each([
    [{ policyNumber: "A", code: "B" }, "insurerId"],
    [{ insurerId: "x", policyNumber: "A", code: "B" }, "insurerId"],
    [{ insurerId: INSURER, policyNumber: " ", code: "B" }, "policyNumber"],
    [{ insurerId: INSURER, policyNumber: "A".repeat(61), code: "B" }, "policyNumber"],
    [{ insurerId: INSURER, policyNumber: "A" }, "code"],
    [{ insurerId: INSURER, policyNumber: "A", code: 12 }, "code"],
    [{ insurerId: INSURER, policyNumber: "A", code: "C".repeat(41) }, "code"],
  ])("recusa %j (campo %s) sem ecoar o valor", (input, field) => {
    try {
      parseClaimRequest(input);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(JSON.stringify((error as ValidationError).fields)).toContain(field);
      expect(JSON.stringify((error as ValidationError).fields)).not.toContain("CCCC");
    }
  });
});

describe("regras da Fase A confirmadas (BR-SEG-25/26/27)", () => {
  it("BR-SEG-25: o código de reclamação vale 7 dias, tem 8 caracteres sem ambiguidades e o HMAC ignora hífen e maiúsculas", () => {
    expect(CLAIM_CODE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    const code = generateClaimCode();
    expect(code).toHaveLength(CLAIM_CODE_LENGTH);
    for (const ch of code) expect(CLAIM_CODE_ALPHABET).toContain(ch);
    expect(hashClaimCode("s", formatClaimCode(code))).toBe(hashClaimCode("s", code.toLowerCase()));
    expect(hashClaimCode("s", code)).not.toBe(hashClaimCode("outro", code));
  });

  it("BR-SEG-26: nº de cartão = VF + 14 dígitos", () => {
    for (let i = 0; i < 50; i++) expect(generateCardNumber()).toMatch(/^VF\d{14}$/);
  });

  it("BR-SEG-27: limite do ficheiro de importação = 10 MB", () => {
    expect(MAX_IMPORT_BYTES).toBe(10 * 1024 * 1024);
  });
});
