import { describe, expect, it } from "vitest";
import { newId } from "./index.js";

describe("newId", () => {
  it("devolve um UUID v4 válido", () => {
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("gera valores diferentes em cada chamada", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newId()));
    expect(ids.size).toBe(50);
  });
});
