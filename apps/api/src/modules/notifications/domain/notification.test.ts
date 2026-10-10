import { describe, expect, it } from "vitest";
import { decideRetry, MAX_RETRIES, RETRY_BACKOFF_MS } from "./notification.js";

describe("decideRetry (ST6: backoff 1,5,15,60,240 min; máx. 5 tentativas)", () => {
  const now = new Date("2026-10-10T12:00:00Z");

  it.each([
    [1, 1],
    [2, 5],
    [3, 15],
    [4, 60],
    [5, 240],
  ])("tentativa %i agenda retry a +%i min", (attempts, minutes) => {
    const decision = decideRetry(attempts, now);
    expect(decision.terminal).toBe(false);
    if (!decision.terminal) {
      expect(decision.nextAttemptAt.getTime()).toBe(now.getTime() + minutes * 60_000);
    }
  });

  it("esgota ao exceder MAX_RETRIES (6ª tentativa, terminal, sem novo agendamento)", () => {
    expect(MAX_RETRIES).toBe(5);
    const decision = decideRetry(6, now);
    expect(decision.terminal).toBe(true);
  });

  it("RETRY_BACKOFF_MS tem exatamente os 5 valores fixos", () => {
    expect(RETRY_BACKOFF_MS).toEqual([60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 240 * 60_000]);
  });
});
