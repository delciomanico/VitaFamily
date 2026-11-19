// Cursor opaco da lista de marcações (`(startsAt, id)`): ida e volta; qualquer valor inválido ⇒ `MALFORMED_REQUEST` (errors.md).
import { describe, expect, it } from "vitest";
import { DomainError } from "../../../platform/errors/index.js";
import { decodeBookingCursor, encodeBookingCursor } from "./cursor.js";

const ID = "0f9c1a52-7b3e-4d8a-9c21-5e6f7a8b9c0d";
const STARTS = new Date("2026-12-01T09:30:00.000Z");

const encodeRaw = (value: unknown): string => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

function expectMalformed(fn: () => unknown): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(DomainError);
  expect((caught as DomainError).code).toBe("MALFORMED_REQUEST");
}

describe("cursor de marcações: ida e volta", () => {
  it("codifica (startsAt, id) e descodifica os mesmos valores", () => {
    const cursor = encodeBookingCursor(STARTS, ID);
    expect(decodeBookingCursor(cursor)).toEqual({ startsAt: STARTS, id: ID });
  });

  it("o resultado é base64url sem '+', '/' nem '='", () => {
    const cursor = encodeBookingCursor(STARTS, ID);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("preserva os milissegundos", () => {
    const startsAt = new Date("2026-12-01T09:30:00.123Z");
    expect(decodeBookingCursor(encodeBookingCursor(startsAt, ID)).startsAt.getTime()).toBe(startsAt.getTime());
  });

  it("não expõe o JSON em claro (cursor opaco)", () => {
    const cursor = encodeBookingCursor(STARTS, ID);
    expect(cursor).not.toContain(ID);
    expect(Buffer.from(cursor, "base64url").toString("utf8")).toContain(ID);
  });
});

describe("cursor de marcações: entradas inválidas ⇒ MALFORMED_REQUEST", () => {
  it("texto que não é base64url de JSON", () => {
    expectMalformed(() => decodeBookingCursor("não-é-um-cursor!!"));
  });

  it("cadeia vazia", () => {
    expectMalformed(() => decodeBookingCursor(""));
  });

  it("JSON que não é objeto (número, texto, null, array)", () => {
    for (const value of [123, "texto", null, [ID]]) {
      expectMalformed(() => decodeBookingCursor(encodeRaw(value)));
    }
  });

  it("id que não é UUID", () => {
    expectMalformed(() => decodeBookingCursor(encodeRaw({ s: STARTS.toISOString(), id: "não-uuid" })));
  });

  it("id em falta ou não textual", () => {
    expectMalformed(() => decodeBookingCursor(encodeRaw({ s: STARTS.toISOString() })));
    expectMalformed(() => decodeBookingCursor(encodeRaw({ s: STARTS.toISOString(), id: 42 })));
  });

  it("data em falta, não textual ou inválida", () => {
    expectMalformed(() => decodeBookingCursor(encodeRaw({ id: ID })));
    expectMalformed(() => decodeBookingCursor(encodeRaw({ s: 1_700_000_000, id: ID })));
    expectMalformed(() => decodeBookingCursor(encodeRaw({ s: "ontem à tarde", id: ID })));
  });
});
