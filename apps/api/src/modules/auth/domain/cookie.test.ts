import { describe, expect, it } from "vitest";
import { parseCookieHeader } from "./cookie.js";

describe("parseCookieHeader", () => {
  it("devolve objeto vazio para cabeçalho ausente", () => {
    expect(parseCookieHeader(undefined)).toEqual({});
  });

  it("lê vários cookies separados por ponto e vírgula", () => {
    expect(parseCookieHeader("a=1; refresh_token=abc; b=2")).toEqual({
      a: "1",
      refresh_token: "abc",
      b: "2",
    });
  });

  it("descodifica valores com percent-encoding", () => {
    expect(parseCookieHeader("x=a%20b")).toEqual({ x: "a b" });
  });
});
