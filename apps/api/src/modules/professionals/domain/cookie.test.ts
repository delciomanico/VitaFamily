// Testes unitários do parser do cabeçalho Cookie do portal do profissional (BR-MKT-13). Sem I/O.
import { describe, expect, it } from "vitest";
import { PROFESSIONAL_REFRESH_TOKEN_COOKIE, parseCookieHeader } from "./cookie.js";

describe("parseCookieHeader", () => {
  it("devolve vazio quando o cabeçalho não existe", () => {
    expect(parseCookieHeader(undefined)).toEqual({});
  });

  it("devolve vazio para um cabeçalho vazio", () => {
    expect(parseCookieHeader("")).toEqual({});
  });

  it("separa vários cookies", () => {
    expect(parseCookieHeader("a=1; b=dois; c=3")).toEqual({ a: "1", b: "dois", c: "3" });
  });

  it("aceita espaços à volta de cada par", () => {
    expect(parseCookieHeader("  a = 1 ;b=2  ")).toEqual({ a: "1", b: "2" });
  });

  it("descodifica valores url-encoded", () => {
    expect(parseCookieHeader("token=abc%3D%3D%2Fx%20y")).toEqual({ token: "abc==/x y" });
  });

  it("mantém o '=' que faz parte do valor", () => {
    expect(parseCookieHeader("x=a=b")).toEqual({ x: "a=b" });
  });

  it("ignora segmentos sem '=' e chaves vazias", () => {
    expect(parseCookieHeader("semvalor; a=1; =orfao; ;")).toEqual({ a: "1" });
  });

  it("mantém o valor bruto quando a codificação percent é inválida", () => {
    expect(parseCookieHeader("a=%E0%A4%A")).toEqual({ a: "%E0%A4%A" });
  });

  it("lê o cookie de refresh do profissional pelo nome da constante", () => {
    const header = `outro=1; ${PROFESSIONAL_REFRESH_TOKEN_COOKIE}=refresh%2Bvalor`;
    expect(parseCookieHeader(header)[PROFESSIONAL_REFRESH_TOKEN_COOKIE]).toBe("refresh+valor");
  });
});
