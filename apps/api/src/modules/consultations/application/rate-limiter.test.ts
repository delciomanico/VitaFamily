// Limitador de janela deslizante em memória (BR-MKT-66: consulta de horários ≤ 60/min por utilizador). Relógio injetado.
import { describe, expect, it } from "vitest";
import type { ConsultationsClock } from "./ports.js";
import { SlidingWindowLimiter } from "./rate-limiter.js";

const T0 = Date.UTC(2026, 10, 19, 10, 0, 0);
const MIN = 60_000;

function manualClock(start = T0) {
  let current = start;
  const clock: ConsultationsClock = { now: () => new Date(current) };
  return {
    clock,
    at: (ms: number) => {
      current = ms;
    },
  };
}

describe("SlidingWindowLimiter (janela deslizante por chave)", () => {
  it("deixa passar até ao limite e devolve a espera (ms) no pedido seguinte", () => {
    const { clock } = manualClock();
    const limiter = new SlidingWindowLimiter(clock, 3, MIN);
    expect(limiter.hit("u1")).toBeNull();
    expect(limiter.hit("u1")).toBeNull();
    expect(limiter.hit("u1")).toBeNull();
    expect(limiter.hit("u1")).toBe(MIN);
  });

  it("a espera diminui com o tempo e aponta para quando o pedido mais antigo sai da janela", () => {
    const relogio = manualClock();
    const limiter = new SlidingWindowLimiter(relogio.clock, 2, MIN);
    expect(limiter.hit("u1")).toBeNull(); // T0
    relogio.at(T0 + 20_000);
    expect(limiter.hit("u1")).toBeNull(); // T0+20s
    relogio.at(T0 + 30_000);
    expect(limiter.hit("u1")).toBe(30_000); // o T0 sai aos T0+60s
  });

  it("depois de a janela passar, volta a deixar passar", () => {
    const relogio = manualClock();
    const limiter = new SlidingWindowLimiter(relogio.clock, 2, MIN);
    limiter.hit("u1");
    limiter.hit("u1");
    expect(limiter.hit("u1")).not.toBeNull();
    relogio.at(T0 + MIN);
    expect(limiter.hit("u1")).toBeNull();
    expect(limiter.hit("u1")).toBeNull();
    expect(limiter.hit("u1")).not.toBeNull();
  });

  it("as chaves são independentes (outro utilizador não herda o excesso)", () => {
    const { clock } = manualClock();
    const limiter = new SlidingWindowLimiter(clock, 1, MIN);
    expect(limiter.hit("u1")).toBeNull();
    expect(limiter.hit("u1")).not.toBeNull();
    expect(limiter.hit("u2")).toBeNull();
  });

  it("um pedido recusado não conta para a janela (a espera não se acumula)", () => {
    const relogio = manualClock();
    const limiter = new SlidingWindowLimiter(relogio.clock, 1, MIN);
    expect(limiter.hit("u1")).toBeNull();
    relogio.at(T0 + 10_000);
    expect(limiter.hit("u1")).toBe(50_000);
    expect(limiter.hit("u1")).toBe(50_000);
    relogio.at(T0 + MIN);
    expect(limiter.hit("u1")).toBeNull();
  });

  it("a espera é sempre pelo menos 1 ms", () => {
    const relogio = manualClock();
    const limiter = new SlidingWindowLimiter(relogio.clock, 1, MIN);
    limiter.hit("u1");
    relogio.at(T0 + MIN - 1);
    expect(limiter.hit("u1")).toBe(1);
  });

  it("prune não esquece chaves com pedidos recentes e deixa passar as antigas", () => {
    const relogio = manualClock();
    const limiter = new SlidingWindowLimiter(relogio.clock, 1, MIN);
    limiter.hit("ativa");
    limiter.hit("antiga");
    relogio.at(T0 + 30_000);
    limiter.prune();
    expect(limiter.hit("ativa")).not.toBeNull();
    relogio.at(T0 + 2 * MIN);
    limiter.prune();
    expect(limiter.hit("antiga")).toBeNull();
  });
});
